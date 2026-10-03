# Supabase PostgreSQL setup

PitchPresence connects to Supabase through Prisma using the root `DATABASE_URL`.
The frontend calls our API. It does not connect to Supabase or use Supabase API
keys, Auth, or the Data API.

## 1. Configure a fresh project

Use the Free plan and a region close to the backend hosting region. Keep the Data
API disabled and Automatic RLS enabled. Leave application table creation to the
committed Prisma migrations; do not create tables manually.

The tenant migration requires an empty application database. Supabase's own
system schemas are expected, but existing PitchPresence records need a separate
backfill plan. Do not reset a database with records you need.

## 2. Create a backend database role

Generate a password in your own terminal with `openssl rand -hex 32` and save it in
your password manager. In Supabase's SQL Editor, replace the placeholder below
with that password and run this once as the default `postgres` role:

```sql
CREATE ROLE pitchpresence_app
  LOGIN PASSWORD 'REPLACE_WITH_YOUR_GENERATED_ROLE_PASSWORD'
  BYPASSRLS;

GRANT pitchpresence_app TO postgres;
GRANT CONNECT, CREATE ON DATABASE postgres TO pitchpresence_app;
GRANT USAGE, CREATE ON SCHEMA public TO pitchpresence_app;
```

This role will own the application tables it creates during migration. It does
need database-level `CREATE` because the first migration starts with
`CREATE SCHEMA IF NOT EXISTS "public"`. This is separate from permission to create
objects inside the `public` schema. PostgreSQL documents this distinction in its
[CREATE SCHEMA reference](https://www.postgresql.org/docs/current/sql-createschema.html).
It does not need `CREATEDB` for `prisma migrate deploy`, which applies committed migrations
without creating a development shadow database. It can bypass RLS, so its
credentials belong only in the backend and worker. Our API enforces user
permissions and team isolation.

Supabase documents the dedicated Prisma role and the backend connection in its
[Prisma guide](https://supabase.com/docs/guides/database/prisma). This repository
already has Prisma 6 configured; do not run `prisma init`, replace its schema, or
upgrade dependencies just to connect Supabase.

## 3. Copy the Session pooler connection

Click **Connect** in the Supabase dashboard and select **Session pooler**. Copy the
actual connection string, keeping its project reference and pooler hostname.
Session mode uses port `5432` and supports IPv4 and Prisma prepared statements.
Use this mode for our persistent API, worker, and migration command.

Change the username from `postgres.PROJECT_REF` to
`pitchpresence_app.PROJECT_REF`, and use the custom role's password from step 2.
This is not the project's original `postgres` password. Require encrypted
connections with `sslmode=require`:

```dotenv
DATABASE_URL="postgresql://pitchpresence_app.PROJECT_REF:ROLE_PASSWORD@POOLER_HOST:5432/postgres?sslmode=require"
```

Copy the host from the dashboard rather than constructing it from the region.
Hex passwords need no URL encoding. If you choose another password, percent
encode characters with special meaning in a URL.

See Supabase's [connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres)
for session pooling, usernames, IPv4, and TLS configuration. `sslmode=require`
requires encryption; verified server certificates can be configured separately.

## 4. Set local credentials

Edit `.env` in the repository root and replace its `DATABASE_URL` line with your
real connection string. Keep `.env` ignored by Git. Commit only templates with
placeholders. Do not paste database passwords into issues, README files, chat,
or `.env.example`.

For local use:

```dotenv
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:3000
```

Set independent random values for `SESSION_SECRET` and `QR_SIGNING_SECRET`, using
`openssl rand -hex 32` for each if they have not been generated already. Resend
and Paystack credentials are configured separately; Supabase configuration alone
does not enable email verification or payment processing.

You can share a redacted connection string for review, replacing its password
with `REDACTED`. Keep the real password in the ignored local environment file.

## 5. Apply the schema

From the repository root, after installing dependencies and confirming the URL
points to the intended fresh project:

```bash
npm run db:generate
npm run db:deploy
npx prisma migrate status
```

Prisma 6 loads the root `.env` for these commands. `db:deploy` creates the tables
and constraints in the committed migrations. Use `db:migrate` only for generating
new migrations against a separate development database.

Check Supabase's Table Editor for `Team`, `User`, `TrainingSession`, `Attendance`,
`Payment`, and `BackgroundJob`. To inspect the custom role and table RLS flags in
the SQL Editor:

```sql
SELECT rolname, rolcanlogin, rolbypassrls
FROM pg_roles
WHERE rolname = 'pitchpresence_app';

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

For our role, `rolcanlogin` and `rolbypassrls` should be true. Automatic RLS should
enable row security on newly created application tables, without blocking this
trusted backend role. Do not add permissive public policies to fix a backend
connection error.

## 6. Verify the app and deploy later

```bash
npm run build:backend
make start
```

Once the API has started, request
`http://localhost:4000/api/v1/health/ready` to verify it can query the database.
The readiness endpoint checks connectivity; it does not validate all tables or
permissions, so also confirm migrations succeeded. Run `make worker` in a second
terminal when Resend and Paystack are configured.

### Recover the initial database-permission failure

If `20261002000000_initial` failed with `P3018` and PostgreSQL error `42501`
(`permission denied for database postgres`), the initial `CREATE SCHEMA` statement
needs the database-level grant above. In Supabase's SQL Editor, as `postgres`, run:

```sql
GRANT CREATE ON DATABASE postgres TO pitchpresence_app;

SELECT has_database_privilege('pitchpresence_app', 'postgres', 'CREATE')
  AS can_create_schema;
```

Once `can_create_schema` is true, and this is the reported failure at the first
schema statement on a fresh application database, recover from the repository
root:

```bash
npx prisma migrate resolve --rolled-back 20261002000000_initial
npm run db:deploy
npx prisma migrate status
```

`--rolled-back` records that the failed migration can be attempted again; it does
not undo SQL or delete data. This specific failure occurs before the migration
creates application objects. For another failure, inspect the migration log and
any partially applied SQL before marking it rolled back or rerunning it. See
[Prisma's recovery guidance](https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing#failed-migration).
No database reset, manual schema deletion, or false `--applied` resolution is
needed for this permission failure.

On the backend host, store the same `DATABASE_URL` in its environment settings,
with the other backend secrets. Use `NODE_ENV=production` and the frontend's
public HTTPS origin for `APP_URL`. The frontend needs only server-side `API_URL`.
The existing continuous worker still needs adaptation before the proposed Render
Free deployment; the database connection does not solve worker hosting.

Keep integration tests on their dedicated test database. Never set
`TEST_DATABASE_URL` to this app database. Arrange separate database exports:
Supabase Free does not include automatic backups.
