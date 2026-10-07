# PitchPresence

Mobile-first football-team attendance and monthly dues. The monorepo includes the V1 backend and the Next.js frontend, following the warm football editorial design in `design.md`.

## Local setup

Requires Node.js 22.12+ and PostgreSQL 14+. Docker Compose supplies PostgreSQL 16.

```bash
npm ci
cp .env.example .env
# Replace both secrets with independent random values; configure provider credentials.
docker compose up -d
npm run db:generate
npm run db:deploy
npm run build
npm run dev
```

After setup, use `make start` (or just `make`) to start the frontend and backend together. `make frontend` and `make backend` start either service independently; `make worker` runs the background worker in a separate terminal.

In a second terminal, run `npm run worker`. Email OTPs and Paystack webhook settlements require this process. The web app runs on port 3000 and proxies `/api/v1` to the API on port 4000. `APP_URL` must match the frontend origin. The landing page can be previewed independently with `npm run dev:web`, without credentials.

Open `/signup` to create a coach/manager account with name, email and password. Verify the emailed code, then enter your team name. The dashboard lets you invite players and staff, set monthly dues, and connect the team bank account when ready. Staff sign in at `/sign-in` with email/password; players use `/player/sign-in` with email/four-digit PIN and register through a team invitation.

### Existing development database

The tenant migration intentionally requires an empty database; old single-team development records have no tenant or bank destination. Confirm `.env` points to disposable development data before explicitly resetting:

```bash
npm run db:reset:development -- --confirm-development-data-loss
```

This command refuses to run unless `NODE_ENV=development`. It **permanently deletes that database’s data** and applies all migrations. Startup never resets or drops data. Do not run it against staging/production or a database with records you need; those require a separate migration/backfill plan. A fresh empty database only needs `db:deploy`. No development database reset was performed during implementation.

## Checks and commands

```bash
npm run build
npm run typecheck
npm run lint
npm test
npm run docs:generate
```

`npm test` runs the integration suite against embedded PostgreSQL by default. To test multi-connection locking, use an **empty dedicated test database**, deploy the migration, and run:

```bash
DATABASE_URL=postgresql://... npm run db:deploy
TEST_DATABASE_URL=postgresql://... npm test
```

The test suite creates synthetic users and financial records; never point it at a team database. CI runs against a dedicated PostgreSQL service. `db:migrate` creates development migrations; `db:deploy` applies committed migrations in staging and production.

## Documentation

- [UI/UX design specification](design.md)
- [Frontend setup, routes and asset pipeline](apps/web/README.md)
- [PWA installation and release media](docs/frontend/pwa-media.md)
- [Architecture and domain rules](docs/backend/architecture.md)
- [API integration guide](docs/backend/api.md)
- [OpenAPI reference](docs/backend/openapi.json)
- [Architecture decisions](docs/backend/decisions.md)
- [Operations and recovery](docs/backend/runbook.md)
- [Environment configuration](docs/backend/environment.md)
- [Supabase PostgreSQL setup](docs/backend/supabase.md)

The source PRD is `PitchPresence_V1_Detailed_PRD.pdf`. Production provider testing and deployment require your Resend and Paystack accounts.
