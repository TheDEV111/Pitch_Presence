import type { FastifyInstance, FastifyRequest, FastifyReply, HTTPMethods } from 'fastify';
import type { DeviceSession, User, PrismaClient } from '@pitchpresence/database';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z as validation } from 'zod';
import { apiErrorResponse } from '@pitchpresence/shared';
import { responseSchema } from './responses.js';
import { cookieName, keyedDigest, requireRule, safeEqual } from './core.js';
import type { Config } from '../config/index.js';
import type { AuthService } from '../modules/auth/service.js';
declare module 'fastify' {
  interface FastifyRequest {
    authSession: (DeviceSession & { user: User }) | null;
    rawBody: Buffer | null;
  }
}
export interface RouteContext {
  request: FastifyRequest;
  reply: FastifyReply;
  user: User;
  session: DeviceSession;
  params: Record<string, string>;
  teamId: string;
}
type Options = {
  access?: 'public' | 'authenticated' | 'PLAYER' | 'MANAGER';
  query?: boolean;
  raw?: boolean;
  summary?: string;
};
export class Router {
  readonly spec: {
    openapi: string;
    info: { title: string; version: string };
    paths: Record<string, Record<string, unknown>>;
    components: unknown;
  };
  constructor(
    private app: FastifyInstance,
    private config: Config,
    private auth: AuthService,
    public db: PrismaClient,
  ) {
    this.spec = {
      openapi: '3.0.3',
      info: { title: 'PitchPresence API', version: '1.0.0' },
      paths: {},
      components: {
        securitySchemes: {
          deviceCookie: { type: 'apiKey', in: 'cookie', name: cookieName(config) },
        },
      },
    };
  }
  add<S extends z.ZodTypeAny>(
    method: HTTPMethods,
    url: string,
    schema: S,
    handler: (input: z.infer<S>, ctx: RouteContext) => Promise<unknown> | unknown,
    options: Options = {},
  ) {
    const access = options.access ?? 'MANAGER';
    const jsonSchema = zodToJsonSchema(schema, { $refStrategy: 'none', target: 'openApi3' });
    const params = [...url.matchAll(/:([A-Za-z]+)/g)].map((x) => x[1]!);
    const parameters: unknown[] = params.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: {
        type: 'string',
        ...(name === 'month' ? { pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } : { format: 'uuid' }),
      },
    }));
    if (options.query && 'properties' in jsonSchema) {
      for (const [name, s] of Object.entries(jsonSchema.properties ?? {}))
        parameters.push({ name, in: 'query', schema: s });
    }
    if (method !== 'GET' && !options.raw)
      parameters.push({
        name: 'X-CSRF-Token',
        in: 'header',
        required: access !== 'public',
        schema: { type: 'string' },
      });
    if (options.raw)
      parameters.push({
        name: 'x-paystack-signature',
        in: 'header',
        required: true,
        schema: { type: 'string', pattern: '^[a-fA-F0-9]{128}$' },
      });
    if (url.endsWith('/initialize'))
      parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', minLength: 8, maxLength: 128 },
      });
    const successSchema = zodToJsonSchema(responseSchema(method, url), {
      $refStrategy: 'none',
      target: 'openApi3',
    });
    const errors = Object.fromEntries(
      [401, 403, 404, 409, 422, 429, 503].map((status) => [
        status,
        {
          description: 'Structured API error',
          content: {
            'application/json': {
              schema: zodToJsonSchema(apiErrorResponse, {
                $refStrategy: 'none',
                target: 'openApi3',
              }),
            },
          },
        },
      ]),
    );
    const path = url.replace(/:([A-Za-z]+)/g, '{$1}');
    this.spec.paths[path] ??= {};
    this.spec.paths[path]![method.toLowerCase()] = {
      summary: options.summary ?? url.split('/').slice(3).join(' '),
      parameters,
      security: access === 'public' ? [] : [{ deviceCookie: [] }],
      ...(options.raw
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: { type: 'object', additionalProperties: true } },
              },
            },
          }
        : {}),
      ...(method !== 'GET' && !options.raw
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: jsonSchema } },
            },
          }
        : {}),
      responses: {
        200: {
          description: 'Successful operation',
          content: { 'application/json': { schema: successSchema } },
        },
        ...errors,
      },
    };
    this.app.route({
      method,
      url,
      handler: async (request, reply) => {
        const session = await this.auth.resolve(request.cookies[cookieName(this.config)]);
        request.authSession = session;
        if (access !== 'public') {
          requireRule(session, 401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
          if (access !== 'authenticated')
            requireRule(
              session.user.role === access,
              403,
              'FORBIDDEN',
              'You do not have access to this action.',
            );
        }
        if (access === 'PLAYER' || access === 'MANAGER')
          requireRule(
            session?.user.teamId,
            403,
            'TEAM_REQUIRED',
            'Create or join your team first.',
          );
        if (method !== 'GET' && !options.raw) {
          requireRule(
            request.headers.origin === new URL(this.config.APP_URL).origin,
            403,
            'ORIGIN_INVALID',
            'The request origin is not allowed.',
          );
          if (session) {
            const token = request.cookies[cookieName(this.config)]!;
            const csrf = request.headers['x-csrf-token'];
            requireRule(
              typeof csrf === 'string' &&
                safeEqual(csrf, keyedDigest(this.config.SESSION_SECRET, `csrf:${token}`)),
              403,
              'CSRF_INVALID',
              'Refresh your session before retrying.',
            );
          }
        }
        const rawParams = (request.params ?? {}) as Record<string, string>;
        const parsedParams: Record<string, string> = {};
        for (const name of params)
          parsedParams[name] = (
            name === 'month'
              ? validation.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
              : validation.string().uuid()
          ).parse(rawParams[name]);
        const input = schema.parse(
          options.query
            ? request.query
            : options.raw
              ? {}
              : method === 'GET'
                ? {}
                : (request.body ?? {}),
        );
        return handler(input, {
          request,
          reply,
          user: session?.user as User,
          session: session as DeviceSession,
          params: parsedParams,
          teamId: session?.user.teamId as string,
        });
      },
    });
  }
}
export const empty = validation.object({}).strict();
