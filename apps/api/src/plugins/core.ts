import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Prisma, PrismaClient } from '@pitchpresence/database';
import type { Config } from '../config/index.js';
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireRule(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const keyedDigest = (secret: string, value: string) =>
  createHmac('sha256', secret).update(value).digest('hex');
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function localMonth(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  return ['year', 'month'].map((k) => p.find((x) => x.type === k)!.value).join('-');
}
export function localDate(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return ['year', 'month', 'day'].map((k) => p.find((x) => x.type === k)!.value).join('-');
}
export function monthRange(start: string, end = localMonth()) {
  const result: string[] = [];
  let [y, m] = start.split('-').map(Number) as [number, number];
  while (`${y}-${String(m).padStart(2, '0')}` <= end) {
    result.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return result;
}
export type Tx = Prisma.TransactionClient;
export async function lock(
  tx: Tx,
  table: 'User' | 'TrainingSession' | 'MonthlyDues' | 'DuesPeriod' | 'Payment',
  id: string,
) {
  // Table names are a closed union; identifiers never come from HTTP input.
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id=$1::uuid FOR UPDATE`, id);
}
export async function audit(
  tx: Tx,
  actorId: string | null,
  action: string,
  entityId: string,
  requestId?: string,
  changes?: Prisma.InputJsonValue,
  reason?: string,
  teamId?: string | null,
) {
  const actor = actorId
    ? await tx.user.findUnique({ where: { id: actorId }, select: { teamId: true } })
    : null;
  await tx.auditEvent.create({
    data: {
      teamId: teamId ?? actor?.teamId,
      actorId,
      action,
      entityId,
      requestId,
      changes,
      reason,
    },
  });
}
export async function rateLimit(
  db: PrismaClient | Prisma.TransactionClient,
  key: string,
  max: number,
  seconds: number,
) {
  const rows = await db.$queryRaw<{ count: number }[]>`
 INSERT INTO "RateLimitBucket" (key,count,"expiresAt") VALUES (${key},1,now()+${seconds}*interval '1 second')
 ON CONFLICT (key) DO UPDATE SET count=CASE WHEN "RateLimitBucket"."expiresAt"<=now() THEN 1 ELSE "RateLimitBucket".count+1 END,
 "expiresAt"=CASE WHEN "RateLimitBucket"."expiresAt"<=now() THEN now()+${seconds}*interval '1 second' ELSE "RateLimitBucket"."expiresAt" END RETURNING count`;
  requireRule(rows[0]!.count <= max, 429, 'RATE_LIMITED', 'Too many attempts; try again later.');
}
export const cookieName = (c: Config) =>
  c.NODE_ENV === 'production' ? '__Host-pitchpresence' : 'pitchpresence';
export function page<T extends { id: string }>(rows: T[], limit: number) {
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
  };
}
export const cursorPage = (cursor: string | undefined, limit: number) => ({
  take: limit + 1,
  orderBy: { id: 'asc' as const },
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});

export async function actorTeam(db: PrismaClient | Tx, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  requireRule(
    user?.teamId && user.active && user.isVerified,
    403,
    'TEAM_REQUIRED',
    'Create or join your team first.',
  );
  return user.teamId;
}

export async function teamCursor(
  db: PrismaClient,
  table: 'User' | 'Invitation' | 'AuditEvent' | 'MonthlyDues',
  teamId: string,
  cursor?: string,
) {
  if (!cursor) return;
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "${table}" WHERE id=$1::uuid AND "teamId"=$2::uuid`,
    cursor,
    teamId,
  );
  requireRule(rows.length > 0, 404, 'NOT_FOUND', 'The collection cursor is unavailable.');
}
