import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('backfills identities without changing historical rows, membership IDs or existing credentials', async () => {
  const db = new PGlite();
  try {
    const migration = '20261012000000_accounts';
    const folders = (await readdir('prisma/migrations')).filter((name) => name < migration).sort();
    for (const folder of folders)
      await db.exec(await readFile(`prisma/migrations/${folder}/migration.sql`, 'utf8'));
    const manager = '00000000-0000-4000-8000-000000000001';
    const player = '00000000-0000-4000-8000-000000000002';
    const team = '00000000-0000-4000-8000-000000000003';
    const session = '00000000-0000-4000-8000-000000000004';
    const participant = '00000000-0000-4000-8000-000000000005';
    const dues = '00000000-0000-4000-8000-000000000006';
    await db.exec(`
      INSERT INTO "User" (id,email,name,role,"passwordHash","isVerified",active) VALUES ('${manager}','coach@test.com','Coach','MANAGER','password-hash',true,true);
      INSERT INTO "Team" (id,name,"createdBy") VALUES ('${team}','Existing FC','${manager}');
      UPDATE "User" SET "teamId"='${team}' WHERE id='${manager}';
      INSERT INTO "User" (id,email,name,role,"pinHash","teamId","isVerified",active,"removedAt") VALUES ('${player}','player@test.com','Player','PLAYER','pin-hash','${team}',true,false,now());
      INSERT INTO "TrainingSession" (id,"teamId",name,date,"startedBy",latitude,longitude,"locationAccuracy","locationCapturedAt") VALUES ('${session}','${team}','Training','2026-10-12','${manager}',6,3,20,now());
      INSERT INTO "SessionParticipant" (id,"teamId","sessionId","playerId","playerName") VALUES ('${participant}','${team}','${session}','${player}','Player');
      INSERT INTO "Attendance" (id,"teamId","participantId","sessionId","playerId",method,"recordedBy") VALUES (gen_random_uuid(),'${team}','${participant}','${session}','${player}','MANUAL','${manager}');
      INSERT INTO "MonthlyDues" (id,"teamId","playerId",month) VALUES ('${dues}','${team}','${player}','2026-10');
      INSERT INTO "Payment" (id,"teamId","playerId","monthlyDuesId",amount,"minimumAmount",provider,status,"markedBy") VALUES (gen_random_uuid(),'${team}','${player}','${dues}',500000,500000,'EXTERNAL','SUCCESS','${manager}');
      INSERT INTO "AuditEvent" (id,"teamId","actorId",action,"entityId") VALUES (gen_random_uuid(),'${team}','${manager}','TEST','${team}');
      INSERT INTO "DeviceSession" (id,"userId","tokenHash","expiresAt") VALUES (gen_random_uuid(),'${manager}','staff-token',now()+interval '1 day'),(gen_random_uuid(),'${player}','player-token',now()+interval '1 day');
    `);
    const tables = [
      'Team',
      'TrainingSession',
      'SessionParticipant',
      'Attendance',
      'MonthlyDues',
      'Payment',
      'AuditEvent',
    ];
    const before = await Promise.all(
      tables.map((table) => db.query(`SELECT * FROM "${table}" ORDER BY id`)),
    );
    const users = await db.query('SELECT * FROM "User" ORDER BY id');
    await db.exec(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
    for (let i = 0; i < tables.length; i++)
      expect((await db.query(`SELECT * FROM "${tables[i]}" ORDER BY id`)).rows).toEqual(
        before[i]!.rows,
      );
    const after = await db.query<Record<string, unknown>>('SELECT * FROM "User" ORDER BY id');
    expect(
      after.rows.map(({ accountId, ...user }) => {
        expect(accountId).toBe(user.id);
        return user;
      }),
    ).toEqual(users.rows);
    expect(
      (
        await db.query(
          'SELECT id,email,"passwordHash","pinHash","isVerified" FROM "Account" ORDER BY id',
        )
      ).rows,
    ).toEqual([
      {
        id: manager,
        email: 'coach@test.com',
        passwordHash: 'password-hash',
        pinHash: null,
        isVerified: true,
      },
      {
        id: player,
        email: 'player@test.com',
        passwordHash: null,
        pinHash: 'pin-hash',
        isVerified: true,
      },
    ]);
    expect(
      (await db.query('SELECT "tokenHash","authMethod" FROM "DeviceSession" ORDER BY "tokenHash"'))
        .rows,
    ).toEqual([
      { tokenHash: 'player-token', authMethod: 'PIN' },
      { tokenHash: 'staff-token', authMethod: 'PASSWORD' },
    ]);
  } finally {
    await db.close();
  }
});
