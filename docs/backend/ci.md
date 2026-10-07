# GitHub Actions checks

The `Monorepo checks` workflow runs on pushes and pull requests. It installs the
lockfile with Node.js 22, generates Prisma, checks lint and formatting, applies
the committed migrations, builds every workspace, checks TypeScript, runs tests,
checks generated OpenAPI documentation, and runs desktop and mobile browser
journeys. Named steps identify which command failed. New commits cancel an
obsolete run for the same branch or pull request.

The workflow uses its own disposable PostgreSQL 16 service. `DATABASE_URL` and
`TEST_DATABASE_URL` point to that service, never Supabase. Integration fixtures
create separate schemas and remove them when finished. Provider tests use mocks,
so neither Paystack business approval nor Resend credentials are required.
Database cleanup tests always use an isolated embedded database.

Vitest discovers current tests only under `apps`, `packages`, and `scripts`.
Git backups and archived project copies are excluded by that source-directory
selection. Playwright runs the web production build with one worker in CI and
intercepts API calls in its journey fixtures; it does not start the API or worker.
Web-server output appears in the Actions log. The browser step uploads an HTML
report and retained failure traces, including after a test failure, with seven
days of artifact retention. A skipped browser step does not upload a report.

## Inspect a failure

Open the failed run in GitHub **Actions → Monorepo checks**, expand the failed
named step, and inspect the first error. For browser failures, download the
`playwright-report` artifact. Open its report locally with
`npx playwright show-report /path/to/playwright-report`, or inspect a retained
trace with `npx playwright show-trace /path/to/trace.zip`.

With GitHub CLI access:

```sh
gh run list --repo TheDEV111/Pitch_Presence --limit 5
gh run view RUN_ID --repo TheDEV111/Pitch_Presence --log-failed
```

Reproduce the relevant check from the repository root:

```sh
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
npm run docs:generate
git diff --exit-code -- docs/backend/openapi.json
npx playwright install --with-deps chromium
CI=true npm run test:web
```

Without `TEST_DATABASE_URL`, tests use embedded PostgreSQL and the four
multi-connection concurrency tests are skipped. To cover those locally, set
`TEST_DATABASE_URL` to a dedicated disposable PostgreSQL database and rerun
`npm test`; never use the application's Supabase database. Browser tests require
permission to start a localhost server. A restricted environment's `listen EPERM`
is a local execution limitation and does not establish a GitHub runner failure.
