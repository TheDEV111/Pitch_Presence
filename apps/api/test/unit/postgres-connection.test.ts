import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { rootCertificates, type ConnectionOptions } from 'node:tls';
import { Client } from 'pg';
import { expect, it } from 'vitest';
import { postgresConnectionUrl } from '../../../../scripts/postgres-connection.mjs';

it('makes required TLS verification explicit without changing credentials or connection parameters', () => {
  const input =
    'postgresql://user:p%40ss@db.example.com:5432/postgres?sslmode=require&schema=public';
  const output = new URL(postgresConnectionUrl(input));
  expect(output.searchParams.get('sslmode')).toBe('verify-full');
  expect(output.username).toBe('user');
  expect(output.password).toBe('p%40ss');
  expect(output.hostname).toBe('db.example.com');
  expect(output.searchParams.get('schema')).toBe('public');
  expect(new URL(input).searchParams.get('sslmode')).toBe('require');
});

it('supplies the root certificate to the actual driver while retaining hostname verification', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pitchpresence-ca-test-'));
  const certificatePath = join(directory, 'root.crt');
  const certificate = rootCertificates[0];
  if (!certificate) throw new Error('Node must provide a bundled CA certificate for this test.');
  try {
    await writeFile(certificatePath, certificate);
    const url = postgresConnectionUrl(
      'postgresql://user:placeholder@db.example.com/postgres?sslmode=require&uselibpqcompat=true',
      relative(process.cwd(), certificatePath),
    );
    const client = new Client({ connectionString: url });
    expect(new URL(url).searchParams.get('sslrootcert')).toBe(certificatePath);
    const ssl = client.ssl as unknown as ConnectionOptions;
    expect(ssl.ca).toBe(certificate);
    expect(ssl.rejectUnauthorized).not.toBe(false);
    expect(ssl.checkServerIdentity).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('preserves a local non-TLS connection and an existing root-certificate path', () => {
  const local = new Client({
    connectionString: postgresConnectionUrl('postgresql://localhost/test'),
  });
  expect(local.ssl).toBe(false);
  const url = new URL(
    postgresConnectionUrl(
      'postgresql://db.example.com/test?sslmode=require&sslrootcert=existing.crt',
    ),
  );
  expect(url.searchParams.get('sslrootcert')).toBe('existing.crt');
  expect(url.searchParams.get('sslmode')).toBe('verify-full');
});
