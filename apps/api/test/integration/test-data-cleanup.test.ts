import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, expect, it } from 'vitest';

// Always isolated and embedded: cleanup tests must never use DATABASE_URL.
let pg: PGlite;
const cleanup = await readFile('scripts/clear-test-data.sql', 'utf8');
const tables = [...new Set([...cleanup.matchAll(/public\."(\w+)"/g)].map((m) => m[1]))];
const coachId = '00000000-0000-4000-8000-000000000001';
const teamId = '00000000-0000-4000-8000-000000000002';

beforeEach(async () => {
  pg = new PGlite();
  const folders = (await readdir('prisma/migrations', { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    await pg.exec(await readFile(`prisma/migrations/${folder}/migration.sql`, 'utf8'));
  }
  await pg.exec(`
    CREATE TABLE "_prisma_migrations" (id text PRIMARY KEY);
    INSERT INTO "_prisma_migrations" VALUES ('preserve-this-migration');
    CREATE TABLE unrelated_notes (note text);
    INSERT INTO unrelated_notes VALUES ('preserve-this-note');
    INSERT INTO "User" (id, email, name, role, "passwordHash")
      VALUES ('${coachId}', 'coach@example.com', 'Test coach', 'MANAGER', 'test-hash');
    INSERT INTO "Team" (id, name, "createdBy")
      VALUES ('${teamId}', 'Test team', '${coachId}');
    UPDATE "User" SET "teamId" = '${teamId}' WHERE id = '${coachId}';
    INSERT INTO "AuditEvent" (id, "teamId", "actorId", action, "entityId")
      VALUES (gen_random_uuid(), '${teamId}', '${coachId}', 'TEAM_CREATED', '${teamId}');
    INSERT INTO "BackgroundJob" (id, "teamId", kind, payload, "deduplicationKey")
      VALUES (gen_random_uuid(), '${teamId}', 'EMAIL_OTP', '{}', 'test-email-job');
    INSERT INTO "VerificationToken" (id, "userId", purpose, "otpHash", "expiresAt")
      VALUES (gen_random_uuid(), '${coachId}', 'VERIFY_EMAIL', 'test-hash', now() + interval '10 minutes');
    INSERT INTO "DeviceSession" (id, "userId", "tokenHash", "expiresAt")
      VALUES (gen_random_uuid(), '${coachId}', 'test-session', now() + interval '1 day');
    INSERT INTO "RateLimitBucket" (key, count, "expiresAt")
      VALUES ('test-email-cooldown', 1, now() + interval '1 minute');
  `);
});
afterEach(async () => {
  await pg?.close();
});

it('clears every app model while preserving migrations, unrelated data, and database protections', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
  expect([...tables].sort()).toEqual(models.sort());
  const protections = `
    SELECT conname AS name, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
    UNION ALL
    SELECT tgname AS name, pg_get_triggerdef(oid) AS definition
    FROM pg_trigger WHERE NOT tgisinternal
    ORDER BY name, definition`;
  const before = await pg.query(protections);
  await expect(pg.exec('DELETE FROM "AuditEvent"')).rejects.toThrow();

  await pg.exec(cleanup);

  for (const table of tables) {
    expect((await pg.query(`SELECT count(*)::int AS count FROM public."${table}"`)).rows).toEqual([
      { count: 0 },
    ]);
  }
  expect((await pg.query('SELECT * FROM "_prisma_migrations"')).rows).toEqual([
    { id: 'preserve-this-migration' },
  ]);
  expect((await pg.query('SELECT * FROM unrelated_notes')).rows).toEqual([
    { note: 'preserve-this-note' },
  ]);
  expect((await pg.query(protections)).rows).toEqual(before.rows);

  // A fresh account can reuse the old email; audit rows remain append-only.
  await pg.exec(`
    INSERT INTO "User" (id, email, name, role, "passwordHash")
      VALUES ('${coachId}', 'coach@example.com', 'Fresh coach', 'MANAGER', 'new-hash');
    INSERT INTO "AuditEvent" (id, action, "entityId")
      VALUES (gen_random_uuid(), 'TEST', '${coachId}');
  `);
  await expect(pg.exec('DELETE FROM "AuditEvent"')).rejects.toThrow();
});

it('refuses foreign-key expansion into unrelated tables and leaves all original data intact', async () => {
  await pg.exec(`
    CREATE TABLE unrelated_membership ("userId" uuid REFERENCES "User" (id));
    INSERT INTO unrelated_membership VALUES ('${coachId}');
  `);
  await expect(pg.exec(cleanup)).rejects.toThrow();
  await pg.exec('ROLLBACK');
  for (const table of ['User', 'Team', 'AuditEvent', 'BackgroundJob', 'RateLimitBucket']) {
    expect((await pg.query(`SELECT count(*)::int AS count FROM public."${table}"`)).rows).toEqual([
      { count: 1 },
    ]);
  }
  expect((await pg.query('SELECT "userId" FROM unrelated_membership')).rows).toEqual([
    { userId: coachId },
  ]);
});
