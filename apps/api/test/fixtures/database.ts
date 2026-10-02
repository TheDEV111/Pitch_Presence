import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@pitchpresence/database';
import type { SqlDriverAdapterFactory } from '@prisma/client/runtime/library.js';
type Driver = Awaited<ReturnType<SqlDriverAdapterFactory['connect']>>;
type Query = Parameters<Driver['queryRaw']>[0];
type Result = Awaited<ReturnType<Driver['queryRaw']>>;
// Test-only adapter. PGlite executes real PostgreSQL SQL without opening a socket.
// Its one connection is serialized; multi-connection lock behavior requires TEST_DATABASE_URL.
export async function testDatabase() {
  const folders = (await readdir('prisma/migrations', { withFileTypes: true }))
    .filter((x) => x.isDirectory())
    .map((x) => x.name)
    .sort();
  const sql = (
    await Promise.all(
      folders.map((folder) => readFile(`prisma/migrations/${folder}/migration.sql`, 'utf8')),
    )
  ).join('\n');
  if (process.env.TEST_DATABASE_URL) {
    const schema = `test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    await admin.query(sql);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('schema', schema);
    const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    return {
      db,
      close: async () => {
        await db.$disconnect();
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        await admin.end();
      },
      embedded: false,
    };
  }
  const pg = new PGlite();
  await pg.exec(sql);
  let tail = Promise.resolve();
  async function acquire() {
    let release!: () => void;
    const wait = tail;
    tail = new Promise<void>((r) => {
      release = r;
    });
    await wait;
    return release;
  }
  const info = { provider: 'postgres' as const, adapterName: 'pitchpresence-test-pglite' };
  const columnTypes: Record<number, Result['columnTypes'][number]> = {
    16: 5,
    17: 13,
    20: 1,
    21: 0,
    23: 0,
    25: 7,
    700: 2,
    701: 3,
    1043: 7,
    1082: 8,
    1114: 10,
    1184: 10,
    1700: 4,
    2950: 15,
    114: 11,
    3802: 11,
  };
  async function queryRaw(q: Query): Promise<Result> {
    const r = await pg.query<Record<string, unknown>>(q.sql, q.args);
    return {
      columnNames: r.fields.map((f) => f.name),
      columnTypes: r.fields.map((f) => columnTypes[f.dataTypeID] ?? 12),
      rows: r.rows.map((row) =>
        r.fields.map((f) => {
          const v = row[f.name];
          if (v instanceof Date) return v.toISOString();
          if (typeof v === 'bigint') return v.toString();
          if (f.dataTypeID === 3802 || f.dataTypeID === 114)
            return v === null ? null : JSON.stringify(v);
          return v;
        }),
      ),
    };
  }
  async function executeRaw(q: Query) {
    return (await pg.query(q.sql, q.args)).affectedRows ?? 0;
  }
  const factory: SqlDriverAdapterFactory = {
    ...info,
    connect: async () => ({
      ...info,
      queryRaw: async (q) => {
        const release = await acquire();
        try {
          return await queryRaw(q);
        } finally {
          release();
        }
      },
      executeRaw: async (q) => {
        const release = await acquire();
        try {
          return await executeRaw(q);
        } finally {
          release();
        }
      },
      executeScript: async (sql) => {
        await pg.exec(sql);
      },
      startTransaction: async () => {
        const release = await acquire();
        await pg.exec('BEGIN');
        return {
          ...info,
          options: { usePhantomQuery: true },
          queryRaw,
          executeRaw,
          commit: async () => {
            try {
              await pg.exec('COMMIT');
            } finally {
              release();
            }
          },
          rollback: async () => {
            try {
              await pg.exec('ROLLBACK');
            } finally {
              release();
            }
          },
        };
      },
      getConnectionInfo: () => ({ schemaName: 'public', supportsRelationJoins: false }),
      dispose: async () => {},
    }),
  };
  const db = new PrismaClient({ adapter: factory });
  return {
    db,
    close: async () => {
      await db.$disconnect();
      await pg.close();
    },
    embedded: true,
  };
}
