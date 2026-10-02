import type { PrismaClient } from '@pitchpresence/database';
import { actorTeam, audit, lock, requireRule } from '../../plugins/core.js';
import type { TrainingService } from '../training/service.js';
export class AttendanceService {
  constructor(
    private db: PrismaClient,
    private training: TrainingService,
  ) {}
  async checkIn(token: string, playerId: string, requestId: string) {
    const teamId = await actorTeam(this.db, playerId);
    const sessionId = await this.training.validate(token, teamId);
    return this.record(sessionId, playerId, undefined, requestId, token);
  }
  async record(
    sessionId: string,
    playerId: string,
    managerId: string | undefined,
    requestId: string,
    token?: string,
  ) {
    const teamId = await actorTeam(this.db, managerId ?? playerId);
    requireRule(
      await this.db.trainingSession.findFirst({ where: { id: sessionId, teamId } }),
      404,
      'NOT_FOUND',
      'Session not found.',
    );
    return this.db.$transaction(async (tx) => {
      await lock(tx, 'TrainingSession', sessionId);
      if (token) await this.training.validate(token, teamId); // Tokens may expire while waiting for the session lock.
      const session = await tx.trainingSession.findUnique({ where: { id: sessionId } });
      requireRule(session, 404, 'NOT_FOUND', 'Session not found.');
      requireRule(session.status === 'OPEN', 409, 'SESSION_CLOSED', 'Attendance is closed.');
      requireRule(
        await tx.user.findFirst({ where: { id: playerId, teamId } }),
        403,
        'PLAYER_UNAVAILABLE',
        'Player is unavailable.',
      );
      await lock(tx, 'User', playerId);
      const player = await tx.user.findUnique({ where: { id: playerId } });
      requireRule(
        player?.teamId === teamId && player.active && player.isVerified && player.role === 'PLAYER',
        403,
        'PLAYER_UNAVAILABLE',
        'Player is unavailable.',
      );
      const participant = await tx.sessionParticipant.findUnique({
        where: { sessionId_playerId: { sessionId, playerId } },
        include: { attendance: true },
      });
      requireRule(
        participant,
        403,
        'PLAYER_INELIGIBLE',
        'The player is not on this session roster.',
      );
      if (participant.attendance)
        return { attendance: participant.attendance, alreadyRecorded: true };
      const row = await tx.attendance.create({
        data: {
          teamId,
          participantId: participant.id,
          sessionId,
          playerId,
          method: managerId ? 'MANUAL' : 'QR',
          recordedBy: managerId,
        },
      });
      // clock_timestamp records the arrival after lock acquisition rather than transaction start.
      const [attendance] = await tx.$queryRaw<
        import('@pitchpresence/database').Attendance[]
      >`UPDATE "Attendance" SET "checkedInAt"=clock_timestamp() WHERE id=${row.id}::uuid RETURNING *`;
      await audit(
        tx,
        managerId ?? playerId,
        managerId ? 'ATTENDANCE_MANUAL' : 'ATTENDANCE_QR',
        row.id,
        requestId,
      );
      return { attendance: attendance!, alreadyRecorded: false };
    });
  }
  async roster(sessionId: string, teamId: string) {
    const session = await this.db.trainingSession.findFirst({
      where: { id: sessionId, teamId },
      include: { participants: { include: { attendance: true }, orderBy: { playerName: 'asc' } } },
    });
    requireRule(session, 404, 'NOT_FOUND', 'Session not found.');
    return {
      sessionId,
      status: session.status,
      checkedInCount: session.participants.filter((p) => p.attendance).length,
      players: session.participants.map((p) => ({
        playerId: p.playerId,
        name: p.playerName,
        attendance: p.attendance,
        result: p.attendance
          ? 'PRESENT'
          : session.status === 'CLOSED'
            ? 'ABSENT'
            : 'NOT_CHECKED_IN',
      })),
    };
  }
}
