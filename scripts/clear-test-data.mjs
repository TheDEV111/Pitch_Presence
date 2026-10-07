import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { postgresConnectionUrl } from './postgres-connection.mjs';

async function main() {
  if (
    process.env.NODE_ENV !== 'development' ||
    !process.argv.includes('--confirm-test-data-loss')
  ) {
    throw new Error(
      'Test data cleanup refused. Requires NODE_ENV=development and --confirm-test-data-loss. Stop the API and worker first; this removes all PitchPresence app data from DATABASE_URL.',
    );
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const target = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
  if ((target.searchParams.get('schema') ?? 'public') !== 'public') {
    throw new Error('This cleanup targets only the public schema.');
  }
  if (process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_')) {
    throw new Error('Test data cleanup refused while live Paystack credentials are configured.');
  }
  const certificateArgument = process.argv.find((arg) => arg.startsWith('--ssl-root-cert='));
  const certificate = certificateArgument?.slice('--ssl-root-cert='.length);
  if (certificateArgument && !certificate) {
    throw new Error('Pass a certificate path using --ssl-root-cert=/path/to/certificate.crt.');
  }
  if (certificate) {
    try {
      await readFile(certificate);
    } catch {
      throw new Error('Cannot read the SSL root certificate. Check the --ssl-root-cert path.');
    }
  }
  const sql = await readFile(new URL('./clear-test-data.sql', import.meta.url), 'utf8');
  // Never log the connection URI, credentials, or individual account data.
  console.log(
    `Clearing PitchPresence test data on ${target.hostname}/${target.pathname.slice(1)}.`,
  );
  const client = new Client({
    connectionString: postgresConnectionUrl(process.env.DATABASE_URL, certificate),
    connectionTimeoutMillis: 5000,
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const results = await client.query(sql);
    const counts = results.find((result) => result.command === 'SELECT')?.rows[0];
    console.log('Test data cleared. Database schema and migration history preserved.');
    console.log(counts);
    console.log('Restart the API and worker, then open a fresh private browser window to sign up.');
  } catch (error) {
    if (connected) await client.query('ROLLBACK').catch(() => {});
    const code =
      typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : 'DATABASE_ERROR';
    if (
      !connected &&
      [
        'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      ].includes(code)
    ) {
      throw new Error(
        `Certificate verification failed (${code}). No cleanup ran. Download the database CA certificate from Supabase Database Settings > SSL Configuration, then rerun with --ssl-root-cert=/path/to/downloaded.crt. Alternatively, run scripts/clear-test-data.sql in Supabase SQL Editor.`,
      );
    }
    throw new Error(
      connected
        ? `Cleanup could not be confirmed (${code}). Check the database before retrying.`
        : `Database connection failed (${code}). No cleanup ran. Run this command from a terminal with database access.`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
