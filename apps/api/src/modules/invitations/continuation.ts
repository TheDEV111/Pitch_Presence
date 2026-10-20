import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config/index.js';
import { encrypt, decrypt } from '../../infrastructure/secrets.js';
import { requireRule } from '../../plugins/core.js';
export const INVITATION_CONTINUATION_SECONDS = 1800;
const payloadSchema = z
  .object({
    id: z.string().uuid(),
    token: z.string().min(32).max(200),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export class InvitationContinuation {
  private prefix: string;
  private secret: string;
  constructor(private config: Config) {
    this.prefix = config.NODE_ENV === 'production' ? '__Secure-pp-join-' : 'pp-join-';
    this.secret = `${config.DATA_ENCRYPTION_SECRET}:invitation-continuation:v1`;
  }
  private read(request: FastifyRequest, id: string) {
    try {
      if (!z.string().uuid().safeParse(id).success) return null;
      const cookie = request.cookies[this.prefix + id];
      if (!cookie || cookie.length > 1024) return null;
      const parsed = payloadSchema.safeParse(JSON.parse(decrypt(this.secret, cookie)));
      return parsed.success && parsed.data.id === id && parsed.data.expiresAt > Date.now()
        ? parsed.data
        : null;
    } catch {
      return null;
    }
  }
  resolve(request: FastifyRequest, id: string) {
    const saved = this.read(request, id);
    requireRule(
      saved,
      422,
      'INVITATION_CONTEXT_EXPIRED',
      'Your saved invitation is unavailable. Reopen the original invitation link shared by your team.',
    );
    return saved.token;
  }
  issue(request: FastifyRequest, reply: FastifyReply, token: string, invitationExpiry: Date) {
    const entries = Object.keys(request.cookies)
      .filter((name) => name.startsWith(this.prefix))
      .map((name) => ({ name, payload: this.read(request, name.slice(this.prefix.length)) }));
    const valid = entries
      .filter((entry) => entry.payload)
      .sort((a, b) => a.payload!.expiresAt - b.payload!.expiresAt);
    const discard = new Set([
      ...entries.filter((entry) => !entry.payload).map((entry) => entry.name),
      ...valid.slice(0, Math.max(0, valid.length - 4)).map((entry) => entry.name),
    ]);
    for (const name of discard)
      reply.clearCookie(name, {
        path: '/api/v1',
        secure: this.config.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
      });
    const id = randomUUID();
    const expiresAt = Math.min(
      invitationExpiry.getTime(),
      Date.now() + INVITATION_CONTINUATION_SECONDS * 1000,
    );
    reply.setCookie(
      this.prefix + id,
      encrypt(this.secret, JSON.stringify({ id, token, expiresAt })),
      {
        path: '/api/v1',
        httpOnly: true,
        sameSite: 'lax',
        secure: this.config.NODE_ENV === 'production',
        maxAge: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
      },
    );
    return { contextId: id, contextExpiresAt: new Date(expiresAt).toISOString() };
  }
}
