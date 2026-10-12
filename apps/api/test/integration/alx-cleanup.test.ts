import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
const cleanup = await readFile('scripts/delete-alx-test-team.sql', 'utf8');
const target = '8424095d-9e32-4445-83bd-7b2bc5497292';
const other = '00000000-0000-4000-8000-000000000001';
const owner = '00000000-0000-4000-8000-000000000002';
const player = '00000000-0000-4000-8000-000000000003';
const otherOwner = '00000000-0000-4000-8000-000000000004';
const pending = '00000000-0000-4000-8000-000000000005';
const shared = '00000000-0000-4000-8000-000000000006';
const migration = '20261012000000_accounts';
async function setup(accounts: boolean) {
  const db = new PGlite();
  const folders = (await readdir('prisma/migrations', { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => accounts || name < migration)
    .sort();
  for (const folder of folders)
    await db.exec(await readFile(`prisma/migrations/${folder}/migration.sql`, 'utf8'));
  await db.exec(`
    INSERT INTO "User" (id,email,name,role,"passwordHash") VALUES
     ('${owner}','owner-alx@test.com','ALX coach','MANAGER','original-password'),
     ('${otherOwner}','owner-other@test.com','Other coach','MANAGER','other-password');
    INSERT INTO "Team" (id,name,"createdBy") VALUES ('${target}','ALX','${owner}'),('${other}','Keep FC','${otherOwner}');
    UPDATE "User" SET "teamId"='${target}' WHERE id='${owner}';
    UPDATE "User" SET "teamId"='${other}' WHERE id='${otherOwner}';
    INSERT INTO "User" (id,email,name,role,"pinHash","teamId") VALUES ('${player}','player-alx@test.com','ALX player','PLAYER','original-pin','${target}');
    INSERT INTO "Invitation" (id,"teamId","createdBy",kind,email,"tokenHash","expiresAt") VALUES
     ('00000000-0000-4000-8000-000000000007','${target}','${owner}','MANAGER','pending@test.com','pending-link',now()+interval '1 day');
    INSERT INTO "User" (id,email,name,role,"passwordHash","pendingInvitationId") VALUES
     ('${pending}','pending@test.com','Pending staff','MANAGER','pending-password','00000000-0000-4000-8000-000000000007');
    INSERT INTO "AuditEvent" (id,"actorId",action,"entityId") VALUES (gen_random_uuid(),'${pending}','EMAIL_VERIFIED','${pending}');
    INSERT INTO "BackgroundJob" (id,kind,payload,"deduplicationKey") VALUES
     (gen_random_uuid(),'EMAIL_OTP',jsonb_build_object('userId','${pending}'),'pending-email'),
     (gen_random_uuid(),'OTHER','{}','keep-global');
    INSERT INTO "RateLimitBucket" (key,count,"expiresAt") VALUES ('keep-rate-limit',2,now()+interval '1 hour');
  `);
  if (accounts)
    await db.exec(
      `INSERT INTO "User" (id,"accountId",email,name,role,"pinHash","teamId") SELECT '${shared}',"accountId",email,'Shared player','PLAYER','shared-pin','${other}' FROM "User" WHERE id='${owner}';`,
    );
  for (const [teamId, userId, prefix] of [
    [target, owner, '1'],
    [other, otherOwner, '2'],
  ] as const) {
    const base = `00000000-0000-4000-8000-${prefix}`;
    const participantPlayer = teamId === target ? player : '00000000-0000-4000-8000-000000000008';
    if (teamId === other)
      await db.exec(
        `INSERT INTO "User" (id,email,name,role,"pinHash","teamId") VALUES ('${participantPlayer}','player-other@test.com','Other player','PLAYER','other-pin','${other}');`,
      );
    await db.exec(`
      INSERT INTO "TrainingSession" (id,"teamId",name,date,"startedBy",latitude,longitude,"locationAccuracy","locationCapturedAt") VALUES ('${base}00000000001','${teamId}','Training','2026-10-12','${userId}',6,3,20,now());
      INSERT INTO "SessionParticipant" (id,"teamId","sessionId","playerId","playerName") VALUES ('${base}00000000002','${teamId}','${base}00000000001','${participantPlayer}','Player');
      INSERT INTO "Attendance" (id,"teamId","participantId","sessionId","playerId",method,"recordedBy") VALUES ('${base}00000000003','${teamId}','${base}00000000002','${base}00000000001','${participantPlayer}','MANUAL','${userId}');
      INSERT INTO "MonthlyDues" (id,"teamId","playerId",month) VALUES ('${base}00000000004','${teamId}','${participantPlayer}','2026-10');
      INSERT INTO "Payment" (id,"teamId","playerId","monthlyDuesId",amount,"minimumAmount",provider,status,"markedBy") VALUES ('${base}00000000005','${teamId}','${participantPlayer}','${base}00000000004',500000,500000,'EXTERNAL','SUCCESS','${userId}');
      UPDATE "MonthlyDues" SET status='PAID',"paidAt"=now(),"qualifyingPaymentId"='${base}00000000005' WHERE id='${base}00000000004';
      INSERT INTO "TeamTransferAccount" (id,"teamId","configuredBy","bankName","accountName","encryptedNumber","accountLast4") VALUES ('${base}00000000006','${teamId}','${userId}','Test bank','TEST','encrypted','1234');
      UPDATE "Team" SET "transferAccountId"='${base}00000000006' WHERE id='${teamId}';
      INSERT INTO "PaymentReceipt" (id,"teamId","playerId","monthlyDuesId","accountId","paymentId","fileName","mimeType",size,sha256,status,"reviewedBy","reviewedAt") VALUES ('${base}00000000007','${teamId}','${participantPlayer}','${base}00000000004','${base}00000000006','${base}00000000005','proof.pdf','application/pdf',10,repeat('${prefix}',64),'APPROVED','${userId}',now());
      INSERT INTO "AuditEvent" (id,"teamId","actorId",action,"entityId") VALUES ('${base}00000000008','${teamId}','${userId}','PAYMENT_MARKED','${base}00000000005');
      INSERT INTO "DeviceSession" (id,"userId","tokenHash","expiresAt") VALUES ('${base}00000000009','${userId}','${prefix}-session',now()+interval '1 day');
      INSERT INTO "PushSubscription" (id,"teamId","userId","sessionId","endpointHash","encryptedSubscription","vapidPublicKey") VALUES ('${base}00000000010','${teamId}','${userId}','${base}00000000009','${prefix}-push','encrypted','public');
      INSERT INTO "BackgroundJob" (id,"teamId",kind,payload,"deduplicationKey") VALUES ('${base}00000000011','${teamId}','EMAIL_OTP','{}','${prefix}-email');
    `);
  }
  return db;
}
const scoped = [
  'Team',
  'User',
  'TrainingSession',
  'SessionParticipant',
  'Attendance',
  'MonthlyDues',
  'Payment',
  'PaymentReceipt',
  'TeamTransferAccount',
  'AuditEvent',
  'PushSubscription',
  'BackgroundJob',
];
async function retained(db: PGlite) {
  return Promise.all(
    scoped.map(async (table) => ({
      table,
      rows: (
        await db.query(
          `SELECT * FROM "${table}" WHERE ${table === 'Team' ? 'id' : '"teamId"'}='${other}' ORDER BY id`,
        )
      ).rows,
    })),
  );
}
it.each([false, true])(
  'deletes only ALX, preserving other teams and protections (Account migration: %s)',
  async (accounts) => {
    const db = await setup(accounts);
    try {
      const before = await retained(db);
      const sharedIdentity = accounts
        ? await db.query(
            `SELECT a.* FROM "Account" a JOIN "User" u ON u."accountId"=a.id WHERE u.id='${shared}'`,
          )
        : null;
      await db.exec(cleanup);
      expect(await retained(db)).toEqual(before);
      for (const table of scoped)
        expect(
          (
            await db.query(
              `SELECT count(*)::int AS count FROM "${table}" WHERE ${table === 'Team' ? 'id' : '"teamId"'}='${target}'`,
            )
          ).rows,
        ).toEqual([{ count: 0 }]);
      expect(
        (await db.query(`SELECT id FROM "User" WHERE id IN ('${owner}','${player}','${pending}')`))
          .rows,
      ).toEqual([]);
      expect(
        (await db.query(`SELECT id FROM "BackgroundJob" WHERE "deduplicationKey"='pending-email'`))
          .rows,
      ).toEqual([]);
      expect(
        (await db.query(`SELECT id FROM "BackgroundJob" WHERE "deduplicationKey"='keep-global'`))
          .rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query(
            `SELECT count(*)::int AS count FROM "User" WHERE email LIKE '%@maintenance.invalid'`,
          )
        ).rows,
      ).toEqual([{ count: 0 }]);
      if (accounts) {
        expect(
          (
            await db.query(
              `SELECT a.* FROM "Account" a JOIN "User" u ON u."accountId"=a.id WHERE u.id='${shared}'`,
            )
          ).rows,
        ).toEqual(sharedIdentity!.rows);
        expect(
          (
            await db.query(
              `SELECT id FROM "Account" WHERE email IN ('player-alx@test.com','pending@test.com') OR email LIKE '%@maintenance.invalid'`,
            )
          ).rows,
        ).toEqual([]);
      }
      await expect(db.exec('DELETE FROM "AuditEvent"')).rejects.toThrow();
      await db.exec('ROLLBACK');
      await db.exec(cleanup); // idempotent retry
      expect(await retained(db)).toEqual(before);
    } finally {
      await db.close();
    }
  },
);
it('rolls back all changes when an unexpected foreign record blocks deletion', async () => {
  const db = await setup(true);
  try {
    await db.exec(
      `CREATE TABLE unrelated_team_notes ("teamId" uuid REFERENCES "Team"(id)); INSERT INTO unrelated_team_notes VALUES ('${target}');`,
    );
    const users = await db.query('SELECT * FROM "User" ORDER BY id');
    const team = await db.query(`SELECT * FROM "Team" WHERE id='${target}'`);
    const payment = await db.query(`SELECT * FROM "MonthlyDues" WHERE "teamId"='${target}'`);
    await expect(db.exec(cleanup)).rejects.toThrow();
    await db.exec('ROLLBACK');
    expect((await db.query('SELECT * FROM "User" ORDER BY id')).rows).toEqual(users.rows);
    expect((await db.query(`SELECT * FROM "Team" WHERE id='${target}'`)).rows).toEqual(team.rows);
    expect((await db.query(`SELECT * FROM "MonthlyDues" WHERE "teamId"='${target}'`)).rows).toEqual(
      payment.rows,
    );
    await expect(db.exec('DELETE FROM "AuditEvent"')).rejects.toThrow();
  } finally {
    await db.close();
  }
});
