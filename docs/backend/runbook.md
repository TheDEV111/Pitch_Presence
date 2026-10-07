# Backend operations and recovery

## Deploy and verify

1. Build the image from the committed lockfile. Set environment configuration and provider credentials in the deployment secret store.
2. Run `npm run db:deploy` as a separate migration task against the intended database. Never use `db:push` or development migrations in production.
3. Start the HTTP process (`node apps/api/dist/server.js`) and worker (`node apps/api/dist/worker.js`) from the same image. The deployment must restart a failed worker.
4. Reverse proxy `/api/v1` to the API and other paths to the web application. Preserve Origin and Cookie headers; keep the API's port private. TLS terminates at the proxy. Do not log URI query values or request bodies.
5. Check `/api/v1/health/live` and `/api/v1/health/ready`. Self-register a staff account, verify email, create a team and confirm password login.
6. In staging, run the complete attendance flow and a Paystack test checkout, including a webhook and server-side verification. Confirm the same player/month state in both roles.

`TRUST_PROXY` defaults to empty (disabled). IP rate limits therefore use the direct peer, which may be the reverse proxy. Set `TRUST_PROXY` to the proxy's explicit IPs/CIDRs before relying on per-client IP limiting; never trust arbitrary forwarding headers. Account-level limits still apply across instances.

## Monitoring

HTTP logs expose request ID, route, status and latency; credentials, cookies and query strings are redacted. Feed these into deployment monitoring for error rate and latency alerts.

Poll the authenticated `/management/operations` endpoint for this team’s pending payment count, oldest pending payment, payments requiring review and failed jobs. Global HTTP statistics remain in server logs and are not exposed to a team. Alert on jobs with failedAt, unresolved payments older than 24 hours, and sustained provider/HTTP errors. Audit events identify manual confirmations, reversals and payment reconciliation escalation.

The worker's job table is the recovery source of truth. Check attempt counts, availableAt, leaseUntil, completedAt and failedAt. Job lastError intentionally excludes raw provider responses and secrets.

## Payment investigation

- An unsigned webhook is rejected. A signed `charge.success` event is acknowledged only after a deduplicated verification job is committed. Running the worker is required for settlement.
- Browser callbacks cannot settle dues without verification. Compare the stored reference, amount, currency, player email and snapshotted subaccount with Paystack's verified transaction.
- Unknown initialization or verification outcomes remain PENDING. Do not delete the payment or mark it paid to clear a timeout. The stable provider reference supports reconciliation.
- A checkout without a stored URL can be recovered by replaying the original request/key. If the provider call never completed, do not create a second checkout until Paystack confirms the original reference has no successful charge.
- After 24 hours, unresolved work is flagged needsReview. Management must investigate it in Paystack. V1 has no in-app refund or payment cancellation endpoint.
- To retry exhausted verification after resolving an outage, reset only its failedAt, leaseUntil and leaseToken, and set availableAt to now using the administrative database procedure. Preserve the job key and payment reference; record the intervention as an AuditEvent.
- A valid extra successful transaction is retained with needsReview. Resolve any refund operationally in Paystack; never reverse it through the external-payment endpoint.
- An incorrect external confirmation uses the manager reversal endpoint with a reason. No payment or audit row is removed.

Administrative changes require a restricted operator account and an audit event. App routes never provide an unaudited paid-state override.

## Email and worker recovery

Transient email errors retry five times. Final email failures erase encrypted OTP payloads. Players can request another OTP after cooldown. Superseded or expired challenges are not delivered.

A crashed worker's lease becomes available after 60 seconds. Claim tokens prevent its stale completion from overwriting a newer claim. Resend idempotency keys reduce duplicate mail when delivery succeeded before a crash. Settlement uses unique provider references and transactions, so verification retries are safe.

## Backup and migration recovery

Enable managed daily backups and point-in-time recovery. Rehearse restore into a separate database, deploy compatible application code, and run readiness plus a read-only integrity check of users, session participants, attendance and payment references. Verify the append-only audit trigger and partial unique indexes survived.

Use expand/contract migrations for later schema changes. Roll back application code only if the deployed schema remains compatible; restore or forward-fix a migration instead of modifying already-applied migration files. First installation has no historical application data to migrate.

## Validation boundary

Embedded tests exercise the committed PostgreSQL migration and application flows. Their connection is serialized and cannot demonstrate production lock contention. CI must run with TEST_DATABASE_URL against a real dedicated PostgreSQL service. Real provider smoke tests require your accounts and the callback page; no live email or payment was sent during implementation.

## Development tenant migration

Migration `20261002010000_tenants` requires empty pre-launch tables. Existing single-team development data is not backfilled. After checking DATABASE_URL and retaining anything needed, run `npm run db:reset:development -- --confirm-development-data-loss` with NODE_ENV=development. This explicitly drops development data and applies migrations. Never run it on production/staging or during startup. A populated production database requires a separate backfill plan before this migration.

## Restart onboarding tests with empty app data

For a database containing only disposable test data, stop the API and worker and run from the repository root:

```sh
npm run db:clear:test -- --confirm-test-data-loss
```

Requires `NODE_ENV=development` in `.env`. The command uses `DATABASE_URL`, including a hosted Supabase database if configured; localhost in the browser does not imply a local database. It refuses to run with live Paystack credentials. All 16 app tables are truncated together in one transaction, including accounts, teams, invitations, training, dues, payments, bank profiles, audit events, verification tokens, device sessions, queued jobs, idempotency records, and rate limits. The schema, constraints, indexes, triggers, migration history, and unrelated tables remain intact. External Resend messages and Paystack subaccounts are not removed.

If the terminal cannot reach the database, run the contents of `scripts/clear-test-data.sql` in the intended Supabase project's SQL editor after stopping the API and worker. This SQL is the same destructive cleanup and is only for disposable test data. Successful execution returns zero accounts, teams, training sessions, and queued jobs.

For `SELF_SIGNED_CERT_IN_CHAIN`, Node cannot verify the database certificate using its current trusted CAs. Download the database CA certificate from **Database Settings → SSL Configuration** in the intended Supabase project, then pass its local path:

```sh
npm run db:clear:test -- --confirm-test-data-loss --ssl-root-cert="$HOME/Downloads/prod-ca-2021.crt"
```

Use the actual downloaded filename if different. This option enables `sslmode=verify-full` and supplies `sslrootcert` to node-postgres; server certificate and hostname checks stay enabled. The cleanup normalizes `sslmode=require` to `verify-full` to preserve the installed driver's current behavior without its deprecation warning. It does not modify `.env` or the API's Prisma connection. See [Supabase's SSL configuration guidance](https://supabase.com/docs/guides/platform/ssl-enforcement) and [node-postgres SSL configuration](https://node-postgres.com/features/ssl). If a correct project certificate still fails verification, use the SQL Editor fallback to finish these tests, and investigate the certificate chain before further CLI operations.

Restart `make start` and `make worker`, then use a fresh private browser window. Old cookies point to deleted device sessions, and existing tabs may retain pending-verification email hints in session storage. You can reuse test email addresses, but use newly issued OTPs and invitation links. To test recovery, keep the same browser tab/session open and refresh or navigate away after signup; closing the tab intentionally removes the browser's recovery hint.

## Bank connection recovery

A PENDING/REVIEW bank profile can reflect a provider success followed by a lost response. Use `/management/bank/reconcile` to find its immutable profile ID in Paystack subaccount metadata. Do not create another subaccount until the outcome is established. If none is found or the provider destination is inactive/mismatched, keep REVIEW and investigate through Paystack support/operator tooling. If manual intervention becomes necessary, record team, profile ID, reason and operator in the append-only audit log; do not edit a READY destination or historical payment snapshots. Validate fee routing and account resolution with Paystack test credentials before live use. Team managers must confirm they are authorised to receive team dues; resolution alone is not ownership verification.
