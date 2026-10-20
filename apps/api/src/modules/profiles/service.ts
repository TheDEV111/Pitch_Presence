import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, User } from '@pitchpresence/database';
import type { FootballFields, TeamProfileFields } from '@pitchpresence/shared';
import { audit, lock, rateLimit, requireRule } from '../../plugins/core.js';
import { normalizePhoto } from './photos.js';
export const summarySelect = {
  preferredFoot: true,
  primaryPosition: true,
  secondaryPositions: true,
  photoVersion: true,
} as const;
export class ProfileService {
  constructor(private db: PrismaClient) {}
  private async editable(tx: Prisma.TransactionClient, actor: User) {
    await lock(tx, 'User', actor.id);
    const current = await tx.user.findUnique({ where: { id: actor.id } });
    requireRule(
      current?.role === 'PLAYER' && current.active && current.isVerified && !current.removedAt,
      403,
      'PLAYER_UNAVAILABLE',
      'Your player membership is no longer available.',
    );
  }
  async target(actor: User, id: string, photo = false) {
    const member = await this.db.user.findFirst({
      where: { id, role: 'PLAYER', removedAt: null },
      include: { team: true },
    });
    requireRule(
      member &&
        ((photo && member.accountId === actor.accountId) ||
          (actor.role === 'MANAGER' && member.teamId === actor.teamId) ||
          member.id === actor.id),
      404,
      'PLAYER_UNAVAILABLE',
      'This player profile is unavailable in your team.',
    );
    return member;
  }
  async read(actor: User, id: string) {
    const member = await this.target(actor, id);
    const profile = await this.db.playerProfile.findUnique({
      where: { accountId: member.accountId },
      select: summarySelect,
    });
    const [counts] = await this.db.$queryRaw<{ total: number; attended: number }[]>`
      SELECT count(*)::integer AS total, count(a.id)::integer AS attended
      FROM "SessionParticipant" p JOIN "TrainingSession" s ON s.id=p."sessionId"
      LEFT JOIN "Attendance" a ON a."participantId"=p.id
      WHERE p."playerId"=${member.id}::uuid AND p."teamId"=${member.teamId}::uuid AND s.status='CLOSED'`;
    const { total, attended } = counts!;
    return {
      membershipId: member.id,
      name: member.name,
      teamName: member.team?.name ?? '',
      active: member.active,
      isVerified: member.isVerified,
      profile: {
        preferredFoot: null,
        primaryPosition: null,
        secondaryPositions: [],
        photoVersion: null,
        ...profile,
        shirtNumber: member.shirtNumber,
        assignedPosition: member.assignedPosition,
      },
      attendance: {
        attended,
        missed: total - attended,
        total,
        percentage: total ? Math.round((attended * 100) / total) : null,
      },
    };
  }
  async save(actor: User, input: FootballFields, requestId: string) {
    await this.db.$transaction(async (tx) => {
      await lock(tx, 'Account', actor.accountId);
      await this.editable(tx, actor);
      await tx.playerProfile.upsert({
        where: { accountId: actor.accountId },
        create: { accountId: actor.accountId, ...input },
        update: input,
      });
      await audit(tx, actor.id, 'PLAYER_PROFILE_UPDATED', actor.id, requestId, input);
    });
    return this.read(actor, actor.id);
  }
  async saveTeam(actor: User, id: string, input: TeamProfileFields, requestId: string) {
    await this.db.$transaction(async (tx) => {
      await lock(tx, 'User', id);
      const member = await tx.user.findFirst({
        where: { id, teamId: actor.teamId, role: 'PLAYER', removedAt: null },
      });
      requireRule(
        member,
        404,
        'PLAYER_UNAVAILABLE',
        'This player profile is unavailable in your team.',
      );
      await tx.user.update({ where: { id }, data: input });
      await audit(tx, actor.id, 'PLAYER_TEAM_PROFILE_UPDATED', id, requestId, input);
    });
    return this.read(actor, id);
  }
  async photo(
    actor: User,
    upload: { content: string; mimeType: string } | null,
    requestId: string,
  ) {
    await rateLimit(this.db, `profile-photo:${actor.accountId}`, 10, 3600);
    const photo = upload ? await normalizePhoto(upload.content, upload.mimeType) : null;
    await this.db.$transaction(async (tx) => {
      await lock(tx, 'Account', actor.accountId);
      await this.editable(tx, actor);
      const data = { photo, photoVersion: photo ? randomUUID() : null };
      await tx.playerProfile.upsert({
        where: { accountId: actor.accountId },
        create: { accountId: actor.accountId, ...data },
        update: data,
      });
      await audit(
        tx,
        actor.id,
        photo ? 'PLAYER_PHOTO_UPDATED' : 'PLAYER_PHOTO_REMOVED',
        actor.id,
        requestId,
      );
    });
    return this.read(actor, actor.id);
  }
  async image(actor: User, id: string) {
    const member = await this.target(actor, id, true);
    const profile = await this.db.playerProfile.findUnique({
      where: { accountId: member.accountId },
      select: { photo: true },
    });
    requireRule(profile?.photo, 404, 'PHOTO_UNAVAILABLE', 'No profile photo is available.');
    return Buffer.from(profile.photo);
  }
}
