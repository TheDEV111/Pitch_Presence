import Fastify from 'fastify';
import { TeamService } from './modules/team/service.js';
import { teamRoutes } from './modules/team/routes.js';
import cookie from '@fastify/cookie';
import { Prisma, PrismaClient } from '@pitchpresence/database';
import { ZodError } from 'zod';
import type { Config } from './config/index.js';
import { AppError } from './plugins/core.js';
import { Router, empty } from './plugins/router.js';
import { AuthService } from './modules/auth/service.js';
import { TrainingService } from './modules/training/service.js';
import { AttendanceService } from './modules/attendance/service.js';
import { DuesService } from './modules/dues/service.js';
import { PaymentService } from './modules/payments/service.js';
import { createProviders, type Providers } from './infrastructure/providers.js';
import { authRoutes } from './modules/auth/routes.js';
import { invitationRoutes } from './modules/invitations/routes.js';
import { rosterRoutes } from './modules/roster/routes.js';
import { trainingRoutes } from './modules/training/routes.js';
import { attendanceRoutes } from './modules/attendance/routes.js';
import { duesRoutes } from './modules/dues/routes.js';
import { paymentRoutes } from './modules/payments/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
export async function buildApp(
  config: Config,
  options: { db?: PrismaClient; providers?: Providers } = {},
) {
  const db = options.db ?? new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
  const counters = { requests: 0, errors: 0, authenticationFailures: 0, totalLatencyMs: 0 };
  const app = Fastify({
    bodyLimit: 65_536,
    trustProxy: config.TRUST_PROXY ? config.TRUST_PROXY.split(',').map((x) => x.trim()) : false,
    logger: {
      level: config.LOG_LEVEL,
      redact: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'req.headers["x-paystack-signature"]',
      ],
      serializers: {
        req: (req) => ({
          method: req.method,
          url: String(req.url).split('?')[0],
          hostname: req.hostname,
          remoteAddress: req.ip,
        }),
      },
    },
    disableRequestLogging: true,
  });
  await app.register(cookie);
  app.decorateRequest('authSession', null);
  app.decorateRequest('rawBody', null);
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const raw = body as Buffer;
    request.rawBody = raw;
    if (request.url.split('?')[0] === '/api/v1/payments/paystack/webhook') return done(null, {});
    try {
      done(null, JSON.parse(raw.toString('utf8')));
    } catch {
      done(new AppError(422, 'INVALID_JSON', 'Malformed JSON body.'));
    }
  });
  app.addHook('onSend', async (_, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'no-referrer');
    if (config.NODE_ENV === 'production')
      reply.header('Strict-Transport-Security', 'max-age=31536000');
  });
  app.addHook('onResponse', async (request, reply) => {
    counters.requests++;
    counters.totalLatencyMs += reply.elapsedTime;
    if (reply.statusCode >= 400) counters.errors++;
    if (reply.statusCode === 401) counters.authenticationFailures++;
    app.log.info(
      {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url,
        status: reply.statusCode,
        latencyMs: reply.elapsedTime,
      },
      'request completed',
    );
  });
  app.setErrorHandler((error, request, reply) => {
    let status = 500,
      code = 'INTERNAL_ERROR',
      message = 'An unexpected error occurred.';
    let details: unknown;
    if (error instanceof AppError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof ZodError) {
      status = 422;
      code = 'VALIDATION_FAILED';
      message = 'Check the supplied fields.';
      details = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        status = 409;
        code =
          error.meta?.target && String(error.meta.target).includes('one_open_session')
            ? 'SESSION_ALREADY_OPEN'
            : 'ALREADY_EXISTS';
        message = 'This record already exists or a session is already open.';
      }
      if (error.code === 'P2025') {
        status = 404;
        code = 'NOT_FOUND';
        message = 'Record not found.';
      }
    } else if (error.statusCode && error.statusCode < 500) {
      status = error.statusCode;
      code = 'REQUEST_INVALID';
      message = 'The request could not be processed.';
    }
    if (status === 500)
      app.log.error({ requestId: request.id, errorType: error.name }, 'request failed');
    reply
      .code(status)
      .send({ error: { code, message, requestId: request.id, ...(details ? { details } : {}) } });
  });
  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: request.id } }),
  );
  const providers = options.providers ?? createProviders(config);
  const auth = new AuthService(db, config);
  const training = new TrainingService(db, config);
  const attendance = new AttendanceService(db, training);
  const dues = new DuesService(db);
  const team = new TeamService(db, config, providers);
  const payments = new PaymentService(db, config, providers);
  const router = new Router(app, config, auth, db);
  authRoutes(router, auth, config);
  teamRoutes(router, team);
  invitationRoutes(router, config);
  rosterRoutes(router);
  trainingRoutes(router, training);
  attendanceRoutes(router, attendance);
  duesRoutes(router, dues);
  paymentRoutes(router, payments);
  auditRoutes(router);
  router.add('GET', '/api/v1/health/live', empty, () => ({ status: 'ok' }), { access: 'public' });
  router.add(
    'GET',
    '/api/v1/health/ready',
    empty,
    async () => {
      try {
        await db.$queryRaw`SELECT 1`;
        return { status: 'ready' };
      } catch {
        throw new AppError(503, 'NOT_READY', 'Database unavailable.');
      }
    },
    { access: 'public' },
  );
  router.add('GET', '/api/v1/management/operations', empty, async (_, c) => ({
    pendingPayments: await db.payment.count({ where: { teamId: c.teamId, status: 'PENDING' } }),
    paymentsRequiringReview: await db.payment.count({
      where: { teamId: c.teamId, needsReview: true },
    }),
    failedJobs: await db.backgroundJob.count({
      where: { teamId: c.teamId, failedAt: { not: null } },
    }),
    oldestPendingPayment: await db.payment.findFirst({
      where: { teamId: c.teamId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true },
    }),
  }));
  app.get('/api/v1/openapi.json', async () => router.spec);
  if (!options.db) app.addHook('onClose', async () => db.$disconnect());
  return {
    app,
    db,
    services: { auth, training, attendance, dues, payments, team },
    openapi: router.spec,
  };
}
