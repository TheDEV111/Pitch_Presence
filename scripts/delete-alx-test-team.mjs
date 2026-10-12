import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { postgresConnectionUrl } from './postgres-connection.mjs';
const targetId = '8424095d-9e32-4445-83bd-7b2bc5497292';
const certificate = process.argv
  .find((arg) => arg.startsWith('--ssl-root-cert='))
  ?.slice('--ssl-root-cert='.length);
const execute = process.argv.includes('--confirm-alx-test-data-loss');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const url = new URL(process.env.DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    (url.searchParams.get('schema') ?? 'public') !== 'public'
  )
    throw new Error('A PostgreSQL public-schema connection is required.');
  if (certificate !== undefined) {
    if (!certificate) throw new Error('A certificate path is required.');
    await readFile(certificate);
  }
  const db = new Client({
    connectionString: postgresConnectionUrl(process.env.DATABASE_URL, certificate),
    connectionTimeoutMillis: 5000,
  });
  let connected = false;
  try {
    await db.connect();
    connected = true;
    const preview = await db.query(
      `SELECT t.id,t.name,
      (SELECT count(*)::int FROM "User" WHERE "teamId"=t.id) AS memberships,
      (SELECT count(*)::int FROM "TrainingSession" WHERE "teamId"=t.id) AS training_sessions,
      (SELECT count(*)::int FROM "Payment" WHERE "teamId"=t.id) AS payments,
      (SELECT count(*)::int FROM "PaymentReceipt" WHERE "teamId"=t.id) AS receipts
      FROM "Team" t WHERE t.id=$1::uuid`,
      [targetId],
    );
    console.log(JSON.stringify({ target: targetId, preview: preview.rows }, null, 2));
    if (!execute) {
      console.log(
        'Read-only preview. To delete this authorized test team, stop API/worker writes and rerun with --confirm-alx-test-data-loss.',
      );
      return;
    }
    const sql = await readFile(new URL('./delete-alx-test-team.sql', import.meta.url), 'utf8');
    const results = await db.query(sql);
    console.log(JSON.stringify(results.find((result) => result.command === 'SELECT')?.rows));
  } catch (error) {
    if (connected) await db.query('ROLLBACK').catch(() => {});
    const code =
      typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : 'DATABASE_ERROR';
    throw new Error(
      connected
        ? `ALX cleanup could not be confirmed (${code}); inspect the target before retrying.`
        : `Database connection failed (${code}). No cleanup ran. Use a terminal with database access or the scoped SQL file in Supabase SQL Editor.`,
    );
  } finally {
    await db.end().catch(() => {});
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
