import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { Prisma, type PrismaClient } from '@pitchpresence/database';
import { QR_LIFETIME_SECONDS, QR_REFRESH_SECONDS, type TrainingInput } from '@pitchpresence/shared';
import type { Config } from '../../config/index.js';
import { AppError, actorTeam, audit, localDate, lock, requireRule } from '../../plugins/core.js';
export class TrainingService {
  private signingKey: Uint8Array;
  constructor(
    private db: PrismaClient,
    config: Config,
  ) {
    this.signingKey = new TextEncoder().encode(config.QR_SIGNING_SECRET);
  }
  async start(input: TrainingInput, managerId: string, requestId: string) {
    const teamId = await actorTeam(this.db, managerId);
    const captured = new Date(input.locationCapturedAt);
    requireRule(
      Date.now() - captured.getTime() <= 120_000 && captured.getTime() <= Date.now() + 5000,
      422,
      'LOCATION_UNUSABLE',
      'Capture a fresh location before starting attendance.',
    );
    try {
      return await this.db.$transaction(async (tx) => {
        requireRule(
          !(await tx.trainingSession.findFirst({ where: { teamId, status: 'OPEN' } })),
          409,
          'SESSION_ALREADY_OPEN',
          'An attendance session is already open.',
        );
        const session = await tx.trainingSession.create({
          data: {
            ...input,
            teamId,
            date: localDate(),
            locationCapturedAt: captured,
            startedBy: managerId,
          },
        });
        const players = await tx.user.findMany({
          where: { teamId, role: 'PLAYER', active: true, isVerified: true },
          select: { id: true, name: true },
        });
        if (players.length)
          await tx.sessionParticipant.createMany({
            data: players.map((p) => ({
              teamId,
              sessionId: session.id,
              playerId: p.id,
              playerName: p.name,
            })),
          });
        await audit(tx, managerId, 'SESSION_OPENED', session.id, requestId);
        return session;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppError(409, 'SESSION_ALREADY_OPEN', 'An attendance session is already open.');
      throw error;
    }
  }
  async qr(sessionId: string, teamId: string) {
    const session = await this.db.trainingSession.findFirst({ where: { id: sessionId, teamId } });
    requireRule(session, 404, 'NOT_FOUND', 'Session not found.');
    requireRule(session.status === 'OPEN', 409, 'SESSION_CLOSED', 'Attendance is closed.');
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ sessionId, teamId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('pitchpresence')
      .setAudience('attendance')
      .setIssuedAt(now)
      .setExpirationTime(now + QR_LIFETIME_SECONDS)
      .setJti(randomUUID())
      .sign(this.signingKey);
    return {
      token,
      expiresAt: new Date((now + QR_LIFETIME_SECONDS) * 1000).toISOString(),
      refreshAfterSeconds: QR_REFRESH_SECONDS,
    };
  }
  async validate(token: string, teamId?: string) {
    try {
      const { payload } = await jwtVerify(token, this.signingKey, {
        algorithms: ['HS256'],
        issuer: 'pitchpresence',
        audience: 'attendance',
        requiredClaims: ['iat', 'exp', 'jti', 'sessionId', 'teamId'],
      });
      requireRule(
        typeof payload.sessionId === 'string' &&
          typeof payload.teamId === 'string' &&
          (!teamId || payload.teamId === teamId) &&
          typeof payload.iat === 'number' &&
          typeof payload.exp === 'number' &&
          payload.exp - payload.iat === QR_LIFETIME_SECONDS &&
          payload.iat <= Math.floor(Date.now() / 1000),
        422,
        'QR_INVALID',
        'Scan the QR currently displayed by management.',
      );
      return payload.sessionId;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const expired = (error as { code?: string }).code === 'ERR_JWT_EXPIRED';
      throw new AppError(
        422,
        expired ? 'QR_EXPIRED' : 'QR_INVALID',
        'Scan the QR currently displayed by management.',
      );
    }
  }
  async close(sessionId: string, managerId: string, requestId: string) {
    const teamId = await actorTeam(this.db, managerId);
    requireRule(
      await this.db.trainingSession.findFirst({ where: { id: sessionId, teamId } }),
      404,
      'NOT_FOUND',
      'Session not found.',
    );
    return this.db.$transaction(async (tx) => {
      await lock(tx, 'TrainingSession', sessionId);
      const session = await tx.trainingSession.findUnique({ where: { id: sessionId } });
      requireRule(session, 404, 'NOT_FOUND', 'Session not found.');
      if (session.status === 'CLOSED') return session;
      const [closed] = await tx.$queryRaw<
        import('@pitchpresence/database').TrainingSession[]
      >`UPDATE "TrainingSession" SET status='CLOSED',"closedAt"=clock_timestamp() WHERE id=${sessionId}::uuid RETURNING *`;
      await audit(tx, managerId, 'SESSION_CLOSED', sessionId, requestId);
      return closed!;
    });
  }
}
