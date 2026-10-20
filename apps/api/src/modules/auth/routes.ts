import { z } from 'zod';
import { schemas, pagination } from '@pitchpresence/shared';
import type { Router, RouteContext } from '../../plugins/router.js';
import { empty } from '../../plugins/router.js';
import {
  cookieName,
  digest,
  keyedDigest,
  requireRule,
  rateLimit,
  lock,
} from '../../plugins/core.js';
import type { Config } from '../../config/index.js';
import { AuthService } from './service.js';
import { deviceLabel } from './device.js';
import { InvitationContinuation } from '../invitations/continuation.js';
export function authRoutes(r: Router, auth: AuthService, config: Config) {
  const continuation = new InvitationContinuation(config);
  const invitationToken = (
    input: { invitationToken?: string; invitationContextId?: string },
    ctx: RouteContext,
  ) => {
    requireRule(
      !(input.invitationToken && input.invitationContextId),
      422,
      'VALIDATION_FAILED',
      'Use one invitation reference.',
    );
    return input.invitationContextId
      ? continuation.resolve(ctx.request, input.invitationContextId)
      : input.invitationToken;
  };
  const establish = async (
    result: Awaited<ReturnType<AuthService['createSession']>>,
    ctx: RouteContext,
  ) => {
    await r.db.deviceSession.update({
      where: { tokenHash: digest(result.token) },
      data: { deviceLabel: deviceLabel(ctx.request.headers['user-agent']) },
    });
    ctx.reply.setCookie(cookieName(config), result.token, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400,
    });
    return {
      memberships: result.memberships,
      authMethod: result.authMethod,
      hasPlayerPin: result.hasPlayerPin,
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
    (i, c) => auth.staffRegister({ ...i, invitationToken: invitationToken(i, c) }, c.request.ip),
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
    z
      .object({
        token: z.string().min(32).max(200).optional(),
        invitationContextId: z.string().uuid().optional(),
      })
      .strict(),
    async (i, c) => {
      const token = invitationToken(
        { invitationToken: i.token, invitationContextId: i.invitationContextId },
        c,
      );
      const invitation = token
        ? await r.db.invitation.findUnique({ where: { tokenHash: digest(token) } })
        : c.user.pendingInvitationId
          ? await r.db.invitation.findUnique({ where: { id: c.user.pendingInvitationId } })
          : null;
      requireRule(
        invitation?.kind === 'MANAGER',
        422,
        'INVITATION_INVALID',
        'A staff invitation is required.',
      );
      return auth.acceptInvitation(c.user.id, token, c.session.authMethod);
    },
    { access: 'authenticated' },
  );
  r.add(
    'POST',
    '/api/v1/auth/register',
    schemas.register,
    (i, c) => auth.register({ ...i, invitationToken: invitationToken(i, c)! }, c.request.ip),
    { access: 'public' },
  );
  r.add(
    'POST',
    '/api/v1/auth/resend-otp',
    schemas.email,
    async (i, c) => {
      await rateLimit(r.db, `verification-ip-v2:${c.request.ip}`, 200, 3600);
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
      ...(await auth.context(c.user, c.session.authMethod)),
      csrfToken: keyedDigest(
        config.SESSION_SECRET,
        `csrf:${c.request.cookies[cookieName(config)]!}`,
      ),
    }),
    { access: 'authenticated' },
  );
  r.add(
    'POST',
    '/api/v1/auth/memberships/switch',
    z
      .object({
        membershipId: z.string().uuid(),
        password: schemas.staffLogin.shape.password.optional(),
      })
      .strict(),
    async (i, c) => {
      const result = await auth.switchMembership(
        c.user,
        i.membershipId,
        c.session.authMethod,
        i.password,
      );
      await r.db.deviceSession.update({
        where: { id: c.session.id },
        data: { revokedAt: new Date() },
      });
      await r.db.pushSubscription.deleteMany({ where: { sessionId: c.session.id } });
      return establish(result, c);
    },
    { access: 'authenticated' },
  );
  r.add(
    'POST',
    '/api/v1/auth/invitations/accept',
    z
      .object({
        token: z.string().min(32).max(200).optional(),
        invitationContextId: z.string().uuid().optional(),
        pin: z
          .string()
          .regex(/^\d{4}$/)
          .optional(),
        password: schemas.staffLogin.shape.password.optional(),
      })
      .strict(),
    async (i, c) => {
      const token = invitationToken(
        { invitationToken: i.token, invitationContextId: i.invitationContextId },
        c,
      );
      requireRule(token, 422, 'INVITATION_INVALID', 'Open your team invitation to continue.');
      let method = c.session.authMethod;
      const invitation = await r.db.invitation.findUnique({
        where: { tokenHash: digest(token) },
      });
      if (invitation?.kind === 'MANAGER' && method !== 'PASSWORD') {
        await auth.verifyPassword(c.user.accountId, i.password);
        method = 'PASSWORD';
      }
      const member = await auth.acceptInvitation(c.user.id, token, method, i.pin);
      const result = await auth.createSession(member, method);
      await r.db.deviceSession.update({
        where: { id: c.session.id },
        data: { revokedAt: new Date() },
      });
      await r.db.pushSubscription.deleteMany({ where: { sessionId: c.session.id } });
      return establish(result, c);
    },
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
      await r.db.pushSubscription.deleteMany({ where: { sessionId: c.session.id } });
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
          await r.db.deviceSession.findFirst({
            where: { id: i.cursor, user: { accountId: c.user.accountId } },
          }),
          404,
          'NOT_FOUND',
          'Device cursor unavailable.',
        );
      const rows = await r.db.deviceSession.findMany({
        where: {
          user: { accountId: c.user.accountId },
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          deviceLabel: true,
          authMethod: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
        },
        take: i.limit + 1,
        orderBy: [{ lastUsedAt: 'desc' }, { id: 'desc' }],
        ...(i.cursor ? { cursor: { id: i.cursor }, skip: 1 } : {}),
      });
      return {
        items: rows
          .slice(0, i.limit)
          .map((row) => ({ ...row, isCurrent: row.id === c.session.id })),
        nextCursor: rows.length > i.limit ? rows[i.limit - 1]!.id : null,
      };
    },
    { access: 'authenticated', query: true },
  );
  r.add(
    'POST',
    '/api/v1/auth/sessions/revoke-others',
    z.object({ credential: z.string().min(1).max(128) }).strict(),
    (i, c) => auth.revokeOtherSessions(c.user, c.session.id, i.credential),
    { access: 'authenticated' },
  );
  r.add(
    'DELETE',
    '/api/v1/auth/sessions/:id',
    empty,
    async (_, c) => {
      await r.db.$transaction(async (tx) => {
        await lock(tx, 'Account', c.user.accountId);
        const result = await tx.deviceSession.updateMany({
          where: { id: c.params.id, user: { accountId: c.user.accountId } },
          data: { revokedAt: new Date() },
        });
        requireRule(result.count, 404, 'NOT_FOUND', 'Session not found.');
        await tx.pushSubscription.deleteMany({
          where: { sessionId: c.params.id, user: { accountId: c.user.accountId } },
        });
      });
      return { revoked: true };
    },
    { access: 'authenticated' },
  );
}
