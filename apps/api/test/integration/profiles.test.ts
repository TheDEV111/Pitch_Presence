import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import argon2 from 'argon2';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import type { User } from '@pitchpresence/database';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { testDatabase } from '../fixtures/database.js';
import { seedTeam, bankProviders } from '../fixtures/team.js';
const config = loadConfig({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'profile-session-secret-00000000000000000',
  QR_SIGNING_SECRET: 'profile-qr-secret-0000000000000000000000',
  LOG_LEVEL: 'silent',
});
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let backend: Awaited<ReturnType<typeof buildApp>>;
type Session = Awaited<ReturnType<typeof backend.services.auth.createSession>>;
let coach: User, otherCoach: User, player: User, second: User, teammate: User;
let staff: Session, otherStaff: Session, own: Session, otherMembership: Session, peer: Session;
let hash: string;
const fields = { preferredFoot: 'RIGHT', primaryPosition: 'CM', secondaryPositions: ['DM', 'AM'] };
function request(
  method: 'GET' | 'PATCH' | 'PUT' | 'DELETE' | 'POST',
  path: string,
  session?: Session,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return backend.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: {
      origin: config.APP_URL,
      'content-type': 'application/json',
      ...(session
        ? { cookie: `pitchpresence=${session.token}`, 'x-csrf-token': session.csrfToken }
        : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}
beforeAll(async () => {
  fixture = await testDatabase();
  backend = await buildApp(config, {
    db: fixture.db,
    providers: {
      ...bankProviders,
      sendOtp: async () => {},
      initialize: async () => {
        throw new Error('Not used');
      },
      verify: async () => {
        throw new Error('Not used');
      },
    },
  });
  hash = await argon2.hash('CoachPass123!');
});
beforeEach(async () => {
  async function manager() {
    return seedTeam(
      fixture.db,
      await fixture.db.user.create({
        data: {
          name: 'Coach',
          email: `${randomUUID()}@example.test`,
          role: 'MANAGER',
          passwordHash: hash,
          isVerified: true,
          active: true,
        },
      }),
    );
  }
  coach = await manager();
  otherCoach = await manager();
  player = await fixture.db.user.create({
    data: {
      name: 'Tobi',
      email: `${randomUUID()}@example.test`,
      teamId: coach.teamId,
      pinHash: hash,
      active: true,
      isVerified: true,
    },
  });
  second = await fixture.db.user.create({
    data: {
      name: 'Tobi',
      email: player.email,
      accountId: player.accountId,
      teamId: otherCoach.teamId,
      pinHash: hash,
      active: true,
      isVerified: true,
    },
  });
  teammate = await fixture.db.user.create({
    data: {
      name: 'Peer',
      email: `${randomUUID()}@example.test`,
      teamId: coach.teamId,
      pinHash: hash,
      active: true,
      isVerified: true,
    },
  });
  staff = await backend.services.auth.createSession(coach);
  otherStaff = await backend.services.auth.createSession(otherCoach);
  own = await backend.services.auth.createSession(player);
  otherMembership = await backend.services.auth.createSession(second);
  peer = await backend.services.auth.createSession(teammate);
});
afterAll(async () => {
  if (backend) await backend.app.close();
  if (fixture) await fixture.close();
});
it('shares personal fields across memberships but keeps coach assignments in their own team', async () => {
  expect(
    (await request('GET', '/me/player-profile', own)).json().profile.primaryPosition,
  ).toBeNull();
  const saved = await request('PATCH', '/me/player-profile', own, fields);
  expect(saved.statusCode, saved.body).toBe(200);
  expect(
    (await request('GET', '/me/player-profile', otherMembership)).json().profile.primaryPosition,
  ).toBe('CM');
  expect(
    (
      await request('PATCH', `/management/players/${player.id}/profile`, staff, {
        shirtNumber: 8,
        assignedPosition: 'DM',
      })
    ).statusCode,
  ).toBe(200);
  const ownProfile = (await request('GET', '/me/player-profile', own)).json();
  expect(ownProfile.profile.shirtNumber).toBe(8);
  expect(ownProfile.profile.primaryPosition).toBe('CM');
  expect(
    (await request('GET', '/me/player-profile', otherMembership)).json().profile.shirtNumber,
  ).toBeNull();
  expect(
    (await request('GET', '/management/players', staff))
      .json()
      .items.find((item: { id: string }) => item.id === player.id).playerProfile.primaryPosition,
  ).toBe('CM');
});
it('enforces roles, field ownership, CSRF, workspace selection and team isolation', async () => {
  expect((await request('PATCH', '/me/player-profile', staff, fields)).statusCode).toBe(403);
  expect(
    (await request('PATCH', '/me/player-profile', own, { ...fields, shirtNumber: 9 })).statusCode,
  ).toBe(422);
  expect(
    (await request('PATCH', `/management/players/${player.id}/profile`, staff, fields)).statusCode,
  ).toBe(422);
  expect(
    (await request('GET', `/management/players/${player.id}/profile`, otherStaff)).statusCode,
  ).toBe(404);
  expect((await request('GET', `/management/players/${player.id}/profile`, peer)).statusCode).toBe(
    403,
  );
  expect(
    (await request('PATCH', '/me/player-profile', own, fields, { 'x-csrf-token': 'wrong' }))
      .statusCode,
  ).toBe(403);
  expect(
    (await request('PATCH', '/me/player-profile', own, fields, { 'x-membership-id': second.id }))
      .statusCode,
  ).toBe(409);
  for (const invalid of [
    { ...fields, secondaryPositions: ['CM'] },
    { ...fields, secondaryPositions: ['DM', 'DM'] },
    { ...fields, secondaryPositions: ['DM', 'AM', 'ST'] },
    { ...fields, preferredFoot: 'UNKNOWN' },
  ])
    expect((await request('PATCH', '/me/player-profile', own, invalid)).statusCode).toBe(422);
});
it('normalizes private images, preserves them on failure, and blocks former staff after removal', async () => {
  const bytes = await sharp({ create: { width: 90, height: 120, channels: 3, background: 'red' } })
    .jpeg()
    .withMetadata()
    .toBuffer();
  const uploaded = await request('PUT', '/me/player-profile/photo', own, {
    content: bytes.toString('base64'),
    mimeType: 'image/jpeg',
  });
  expect(uploaded.statusCode, uploaded.body).toBe(200);
  const version = uploaded.json().profile.photoVersion;
  const photo = await request('GET', `/players/${player.id}/photo`, staff);
  expect(photo.statusCode, photo.body.slice(0, 50)).toBe(200);
  expect(photo.headers['cache-control']).toBe('private, no-store');
  expect(photo.headers['content-type']).toContain('image/webp');
  const metadata = await sharp(photo.rawPayload).metadata();
  expect(metadata.width).toBe(512);
  expect(metadata.height).toBe(512);
  expect(metadata.exif).toBeUndefined();
  expect((await request('GET', `/players/${player.id}/photo`, peer)).statusCode).toBe(404);
  expect((await request('GET', `/players/${player.id}/photo`, otherStaff)).statusCode).toBe(404);
  expect((await request('GET', `/players/${player.id}/photo`)).statusCode).toBe(401);
  const bad = await request('PUT', '/me/player-profile/photo', own, {
    content: Buffer.from('<svg/>').toString('base64'),
    mimeType: 'image/png',
  });
  expect(bad.statusCode).toBe(422);
  expect((await request('GET', '/me/player-profile', own)).json().profile.photoVersion).toBe(
    version,
  );
  expect(
    (await request('POST', `/management/players/${player.id}/remove`, staff, {})).statusCode,
  ).toBe(200);
  expect((await request('GET', `/players/${player.id}/photo`, staff)).statusCode).toBe(404);
  expect((await request('GET', `/management/players/${player.id}/profile`, staff)).statusCode).toBe(
    404,
  );
  expect((await request('GET', `/players/${second.id}/photo`, otherStaff)).statusCode).toBe(200);
  expect(
    (await request('GET', '/management/players?includeRemoved=true', staff))
      .json()
      .items.find((item: { id: string }) => item.id === player.id).playerProfile,
  ).toBeNull();
  expect(
    (await request('DELETE', '/me/player-profile/photo', otherMembership, {})).json().profile
      .photoVersion,
  ).toBeNull();
  expect((await request('GET', `/players/${second.id}/photo`, otherStaff)).statusCode).toBe(404);
});
it('computes attendance only from eligible closed training sessions', async () => {
  for (let i = 0; i < 3; i++) {
    const training = await fixture.db.trainingSession.create({
      data: {
        teamId: coach.teamId!,
        name: 'Training',
        startedBy: coach.id,
        date: '2026-10-15',
        latitude: 0,
        longitude: 0,
        locationAccuracy: 10,
        locationCapturedAt: new Date(),
        status: 'CLOSED',
        closedAt: new Date(),
      },
    });
    if (i === 2) continue; // Before the player was included: not an absence.
    const participant = await fixture.db.sessionParticipant.create({
      data: {
        teamId: coach.teamId!,
        sessionId: training.id,
        playerId: player.id,
        playerName: player.name,
      },
    });
    if (i === 0)
      await fixture.db.attendance.create({
        data: {
          teamId: coach.teamId!,
          participantId: participant.id,
          sessionId: training.id,
          playerId: player.id,
          method: 'MANUAL',
          recordedBy: coach.id,
        },
      });
  }
  const open = await fixture.db.trainingSession.create({
    data: {
      teamId: coach.teamId!,
      name: 'Open',
      startedBy: coach.id,
      date: '2026-10-15',
      latitude: 0,
      longitude: 0,
      locationAccuracy: 10,
      locationCapturedAt: new Date(),
    },
  });
  await fixture.db.sessionParticipant.create({
    data: {
      teamId: coach.teamId!,
      sessionId: open.id,
      playerId: player.id,
      playerName: player.name,
    },
  });
  expect((await request('GET', '/me/player-profile', own)).json().attendance).toEqual({
    attended: 1,
    missed: 1,
    total: 2,
    percentage: 50,
  });
  expect(
    (await request('GET', '/me/player-profile', otherMembership)).json().attendance.total,
  ).toBe(0);
});
it('limits image mutations per account across teams without limiting ordinary profile edits', async () => {
  for (let i = 0; i < 10; i++)
    expect(
      (await request('DELETE', '/me/player-profile/photo', i % 2 ? own : otherMembership, {}))
        .statusCode,
    ).toBe(200);
  expect((await request('DELETE', '/me/player-profile/photo', own, {})).statusCode).toBe(429);
  expect((await request('PATCH', '/me/player-profile', own, fields)).statusCode).toBe(200);
});
