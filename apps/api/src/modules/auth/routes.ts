import { z } from 'zod';
import { schemas, pagination } from '@pitchpresence/shared';
import type { Router, RouteContext } from '../../plugins/router.js';
import { empty } from '../../plugins/router.js';
import { cookieName, keyedDigest, requireRule, rateLimit } from '../../plugins/core.js';
import type { Config } from '../../config/index.js';
import { AuthService } from './service.js';
export function authRoutes(r: Router, auth: AuthService, config: Config) {
  const establish = (
    result: Awaited<ReturnType<AuthService['createSession']>>,
    ctx: RouteContext,
  ) => {
    ctx.reply.setCookie(cookieName(config), result.token, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400,
    });
    return {
      user: result.user,
      team: result.team,
      pendingInvitation: result.pendingInvitation,
      nextStep: result.nextStep,
      csrfToken: result.csrfToken,
    };
  };
  r.add(
    'POST',
    '/api/v1/auth/staff-register',
    schemas.staffRegister,
    (i, c) => auth.staffRegister(i, c.request.ip),
    { access: 'public' },
  );
  r.add(
    'POST',
    '/api/v1/auth/staff-login',
    schemas.staffLogin,
    async (i, c) => establish(await auth.login(i.email, i.password, c.request.ip, 'MANAGER'), c),
    { access: 'public' },
  );
  r.add(
    'POST',
    '/api/v1/auth/password-reset/request',
    schemas.email,
    async (i, c) => {
      await rateLimit(r.db, `otp-ip:${c.request.ip}`, 20, 3600);
      return auth.issueOtp(i.email, 'PASSWORD_RESET');
    },
    { access: 'public' },
  );
  r.add(
    'POST',
    '/api/v1/auth/password-reset/confirm',
    schemas.passwordReset,
    (i) => auth.consumeOtp(i.email, i.otp, 'PASSWORD_RESET', i.password),
    { access: 'public' },
  );
  r.add(
    'POST',
    '/api/v1/auth/staff-invitation/accept',
    z.object({ token: z.string().min(32).max(200).optional() }).strict(),
    (i, c) => auth.acceptInvitation(c.user.id, i.token),
    { access: 'authenticated' },
  );
  r.add(
    'POST',
    '/api/v1/auth/register',
    schemas.register,
    (i, c) => auth.register(i, c.request.ip),
    { access: 'public' },
  );
  r.add(
    'POST',
    '/api/v1/auth/resend-otp',
    schemas.email,
    async (i, c) => {
      await rateLimit(r.db, `otp-ip:${c.request.ip}`, 20, 3600);
      return auth.issueOtp(i.email, 'VERIFY_EMAIL');
    },
    { access: 'public' },
  );
  r.add(
    'POST',
    '/api/v1/auth/verify-email',
    schemas.verify,
    async (i, c) => {
      const result = await auth.consumeOtp(i.email, i.otp, 'VERIFY_EMAIL');
      requireRule('token' in result, 500, 'INTERNAL_ERROR', 'Unable to create session.');
      return establish(result, c);
    },
    { access: 'public' },
  );
  r.add(
    'POST',
    '/api/v1/auth/device-login',
    schemas.login,
    async (i, c) => establish(await auth.login(i.email, i.pin, c.request.ip), c),
    { access: 'public' },
  );
  r.add(
    'POST',
    '/api/v1/auth/pin-reset/request',
    schemas.email,
    async (i, c) => {
      await rateLimit(r.db, `otp-ip:${c.request.ip}`, 20, 3600);
      return auth.issueOtp(i.email, 'PIN_RESET');
    },
    { access: 'public' },
  );
  r.add(
    'POST',
    '/api/v1/auth/pin-reset/confirm',
    schemas.reset,
    (i) => auth.consumeOtp(i.email, i.otp, 'PIN_RESET', i.pin),
    { access: 'public' },
  );
  r.add(
    'GET',
    '/api/v1/auth/me',
    empty,
    async (_, c) => ({
      ...(await auth.context(c.user)),
      csrfToken: keyedDigest(
        config.SESSION_SECRET,
        `csrf:${c.request.cookies[cookieName(config)]!}`,
      ),
    }),
    { access: 'authenticated' },
  );
  r.add(
    'POST',
    '/api/v1/auth/logout',
    empty,
    async (_, c) => {
      await r.db.deviceSession.update({
        where: { id: c.session.id },
        data: { revokedAt: new Date() },
      });
      c.reply.clearCookie(cookieName(config), { path: '/' });
      return { loggedOut: true };
    },
    { access: 'authenticated' },
  );
  r.add(
    'GET',
    '/api/v1/auth/sessions',
    pagination,
    async (i, c) => {
      if (i.cursor)
        requireRule(
          await r.db.deviceSession.findFirst({ where: { id: i.cursor, userId: c.user.id } }),
          404,
          'NOT_FOUND',
          'Device cursor unavailable.',
        );
      const rows = await r.db.deviceSession.findMany({
        where: { userId: c.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, createdAt: true, lastUsedAt: true, expiresAt: true },
        take: i.limit + 1,
        orderBy: { id: 'asc' },
        ...(i.cursor ? { cursor: { id: i.cursor }, skip: 1 } : {}),
      });
      return {
        items: rows.slice(0, i.limit),
        nextCursor: rows.length > i.limit ? rows[i.limit - 1]!.id : null,
      };
    },
    { access: 'authenticated', query: true },
  );
  r.add(
    'DELETE',
    '/api/v1/auth/sessions/:id',
    empty,
    async (_, c) => {
      const result = await r.db.deviceSession.updateMany({
        where: { id: c.params.id, userId: c.user.id },
        data: { revokedAt: new Date() },
      });
      requireRule(result.count, 404, 'NOT_FOUND', 'Session not found.');
      return { revoked: true };
    },
    { access: 'authenticated' },
  );
}
