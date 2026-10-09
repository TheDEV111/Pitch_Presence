# VPS deployment handoff

Prepared 9 October 2026. Target: one initial team with fewer than 50 players,
manual dues payments, Vercel frontend, Supabase PostgreSQL, and a friend's Linux
VPS running the API and continuous worker. No Oracle or Northflank account is
needed. This guide prepares a release; deployment and device acceptance still
need to be completed.

Local verification for this handoff: 158 automated tests passed, six skipped
(five require dedicated PostgreSQL concurrency testing, one modern FFmpeg);
backend and guarded frontend builds, TypeScript, lint, formatting, GitHub-token
scans, recorded media checks and both Compose configurations passed. Browser
execution is blocked locally by `listen EPERM`; Docker image execution is blocked
by daemon permissions. The new CI image/proxy checks and live VPS/device checks
are pending, not reported as passed.

## Ownership and prerequisites

The product owner supplies the final frontend domain, backend domain, Supabase
connection, verified Resend sender, and backend secrets through a private channel.
The VPS operator supplies its OS/version, architecture, available RAM/disk, public
IP, and whether ports 80/443 or port 4000 are already occupied. Repo access does
not supply production credentials.

Use Docker Engine and Compose **2.30+** (the configuration uses raw environment
files). A Linux server with approximately 2 GB of available RAM is a reasonable
starting target, not a measured capacity guarantee. Builds need additional memory;
if the VPS is small, build the image on another trusted machine for the same CPU
architecture and transfer it. Verify actual usage with `docker stats` during the
staging session. Do not replace or stop the friend's existing services.

- [Docker installation on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Compose environment-file behaviour](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)
- [Caddy HTTPS reverse proxy](https://caddyserver.com/docs/quick-starts/reverse-proxy)

## What to push and test before handing over

Push the source, package lockfile, all five committed migrations, Dockerfile,
`compose.vps.yaml`, `deploy/vps/`, scripts, and documentation together. Do not push
completed environment files, private keys, database dumps, SSH credentials, ZIP
archives, or test reports. The examples contain placeholders only.

From the repository root, with Node 22.12+ and locked dependencies installed:

```bash
npm ci
npm run db:generate
npm run lint
npm run format:check
npm run security:check
npm test
REQUIRE_LOCAL_MEDIA=true NEXT_PUBLIC_LOCAL_MEDIA=true NEXT_PUBLIC_LOCAL_FONTS=true npm run build
npm run typecheck
npm run security:check:browser
npm run media:verify -- --recorded-only
CI=true npm run test:web
```

Install Chromium using `npx playwright install --with-deps chromium` if needed.
`--recorded-only` checks media files against recorded metadata and hashes; run
`npm run media:verify` with FFprobe installed for an independent video inspection.
The token checks specifically detect GitHub tokens; also review staged changes
and confirm that no environment file or credential is staged.

Wait for **Monorepo checks** to pass for the exact pushed commit. CI uses a
disposable PostgreSQL service for the concurrency tests. Never set
`TEST_DATABASE_URL` to your Supabase team database: integration tests mutate data.
The VPS image job also builds the Docker image, runs environment preflight and
migrations against disposable PostgreSQL, and starts both production processes.
These checks do not prove real email, push delivery, GPS or production proxy
behaviour.

## Topology and domains

```text
Browser -> HTTPS Vercel frontend -> /api/* rewrite -> HTTPS VPS proxy -> API
                                                                         |
Worker ----------------------------------------------------------> Supabase
  +-> Resend and browser push services
```

Choose an API subdomain such as `api.kairos-devs.com` and point its DNS A record to
the VPS. This is an example, not a domain already deployed by this guide. Do not
change existing MX/TXT email records. Only add an AAAA record if the server really
supports incoming IPv6. For the included Caddy setup, start with the Cloudflare
record set to DNS-only so certificate and routing checks are direct. If enabling
Cloudflare proxying later, use Full (strict), do not cache `/api/*`, and retest
uploads and authentication.

Determine the exact frontend HTTPS origin before onboarding users. Set that as
`APP_URL`, including any `www` prefix, without a path. An unrelated Vercel preview
origin will not pass the API's origin checks; use a stable staging domain or a
separate staging environment. Set Vercel's **server/build** variable `API_URL` to
the HTTPS API origin and rebuild after changes. Keep database/provider/private
VAPID keys out of Vercel and all `NEXT_PUBLIC_*` variables.

## Private environment setup

Create `/etc/pitchpresence/backend.env` from
`deploy/vps/backend.env.example` and protect it with permissions `600`. The user
running Docker Compose must be able to read it. Store it outside the checkout;
never attach it to a GitHub issue, report or build artifact.

Copy `deploy/vps/compose.env.example` to ignored `.env.vps` in the checkout and
set the actual hostname, TLS email and `BACKEND_ENV_FILE` absolute path. Confirm
that `172.30.40.0/24` does not overlap existing VPS/Docker/VPN networks; if it
does, change the subnet, gateway and proxy IP together. Set `IMAGE_TAG` to the
full release commit from `git rev-parse HEAD`.

The backend file is read in **raw** mode: use literal, unquoted values, including
`EMAIL_FROM=PitchPresence <sender@app.kairos-devs.com>`. URL-encode special
characters in the database password. Use the Supabase session-pooler connection
on port 5432, with TLS and a modest connection pool (for example
`connection_limit=2&pool_timeout=10`). Keep certificate validation enabled.

Both processes receive the same backend file. The Compose file enforces
`NODE_ENV=production`, `PAYMENT_MODE=MANUAL` and the API's port/trusted proxy.
Paystack remains disabled.

| Value                                 | Owner action                                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                        | Supply the intended Supabase database connection privately.                                                                                                                   |
| `APP_URL`                             | Exact frontend HTTPS origin.                                                                                                                                                  |
| `SESSION_SECRET`, `QR_SIGNING_SECRET` | Preserve keys when continuing an existing database; for a new environment generate independent keys with `openssl rand -hex 32`.                                              |
| `DATA_ENCRYPTION_SECRET`              | Preserve the existing value when using the current database. Changing it makes existing bank/subscription ciphertext unreadable. Back it up privately with recovery material. |
| `RESEND_API_KEY`, `EMAIL_FROM`        | Current key and sender permitted on the verified `app.kairos-devs.com` domain. Replace any previously exposed provider credentials before live use.                           |
| All three `VAPID_*` values            | Copy the existing matching key pair/contact for device notifications. Empty values disable push; a partial configuration fails validation.                                    |

Generate VAPID keys once using `npm run push:setup -- mailto:operator@your-domain.com`
only if none exist yet, then transfer them privately. Do not regenerate keys on
each deployment. See [environment reference](environment.md) and
[push setup](receipt-notifications-roster.md). Environment preflight checks
configuration without displaying values; it does not connect to providers.

## First deployment: unused ports 80/443

Use this option only if the friend confirms that no existing HTTPS proxy owns
these ports. Allow inbound HTTP/HTTPS and the operator's SSH access. The API has
no public port mapping; the worker has no listener. Caddy obtains and renews TLS
certificates and persists them in Docker volumes. Access logging is not enabled.

From the checkout root, after filling the environment files:

```bash
docker compose version
docker compose --env-file .env.vps -f compose.vps.yaml --profile edge config --quiet
docker compose --env-file .env.vps -f compose.vps.yaml build api
docker compose --env-file .env.vps -f compose.vps.yaml run --rm --no-deps preflight
docker compose --env-file .env.vps -f compose.vps.yaml run --rm --no-deps migrate
docker compose --env-file .env.vps -f compose.vps.yaml --profile edge up -d api worker caddy
docker compose --env-file .env.vps -f compose.vps.yaml ps
```

Do not use plain `docker compose up` for production: the root `compose.yaml` is a
local database setup. Do not run database reset/clear scripts, `prisma db push`,
`migrate dev`, or a seed against the team database. Back up existing data before
applying migrations. Existing populated databases must already have their prior
migrations recorded; the original tenant migration expects an empty database.

`config --quiet` checks syntax without printing resolved secrets. Do not paste
unredacted `docker inspect`, rendered Compose configuration, or environment
output into support chats. The image excludes `.env*` and credential directories.

## First deployment: an existing VPS reverse proxy

Keep the existing proxy and TLS setup. Do **not** enable the `edge` profile.
Add `-f deploy/vps/compose.host-proxy.yaml` to the Compose commands above, and
start only `api worker`. The override publishes the API on **127.0.0.1:4000**.
If that port is occupied, change the override's host port and proxy upstream.

Configure a new virtual host for the API domain pointing to
`http://127.0.0.1:4000`. Preserve `/api/*` paths, `Origin`, cookies, CSRF headers,
and `Set-Cookie`. Allow at least 4 MB request bodies for the base64-encoded 2 MB
receipt limit. For Nginx, use `client_max_body_size 4m`, set forwarded headers
from the real connection, and bypass response caching. Do not trust arbitrary
client-supplied forwarding headers. Retain the existing site's configuration.

The override trusts the configured Docker gateway and loopback only. Verify the
actual peer and IP-rate-limit behaviour before relying on forwarded addresses;
rootless Docker or a containerised existing proxy may need different explicit
trusted IPs. Vercel adds another proxy hop: the apparent IP may be Vercel's
egress IP rather than the individual player's. Never fix this by setting
unrestricted proxy trust. Account-level limits remain enforced.

## Vercel setup after the API is reachable

Import the repository as Next.js with root directory `apps/web`; keep workspace
dependency installation at the monorepo root. Use build command:
`npm run build -w @pitchpresence/shared && npm run build -w @pitchpresence/web`.
Set `API_URL=https://<actual-api-domain>`, `NEXT_PUBLIC_LOCAL_MEDIA=true`,
`NEXT_PUBLIC_LOCAL_FONTS=true`, and `REQUIRE_LOCAL_MEDIA=true`, then deploy.
Verify the Vercel build log installs workspace dependencies and runs the PWA
build script. Check the deployment's eligibility for the selected Vercel plan.

Check both the direct API health URL and the frontend rewrite:

```bash
curl --fail --silent --show-error https://ACTUAL_API_DOMAIN/api/v1/health/live
curl --fail --silent --show-error https://ACTUAL_API_DOMAIN/api/v1/health/ready
curl --fail --silent --show-error https://ACTUAL_FRONTEND_DOMAIN/api/v1/health/ready
```

Replace the uppercase hostnames. Readiness checks the database; it does not
prove the worker delivered email. Confirm an HTTPS, Secure, HttpOnly,
`__Host-pitchpresence` cookie is stored on the frontend origin and authenticated
requests work through its `/api/*` rewrite. Do not call the API origin directly
from browser code as a workaround.

## Acceptance before inviting the team

Use one coach, another staff account and two player test accounts initially.
Record results with the commit, deployment date and devices; omit credentials
and private receipts from shared reports.

| Check                 | Required result                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staff signup/recovery | Real email arrives promptly; interrupted onboarding resumes; password login works.                                                                                                                                             |
| Player invitation/PIN | Invited player registers and signs in; player cannot open management.                                                                                                                                                          |
| Training outdoors     | Accurate coach GPS; phone scan within the 30-second QR window; duplicates/expired tokens rejected; manual attendance and closure work.                                                                                         |
| Manual dues           | Confirmed bank details appear; PNG and PDF upload; pending proof does not mark paid; staff approve/reject and direct marking/reversal behave correctly.                                                                        |
| Dues search/removal   | Name search finds the player; removal preserves history and produces the specific team-removal error on subsequent protected access/correct-PIN login.                                                                         |
| Receipt push          | Staff explicitly enable alerts; with app closed, receipt notification opens the right month; signed-out device receives no new queued alerts. Test Android and installed iPhone PWA.                                           |
| PWA/media             | Installation, offline fallback, update, 15-second film and reduced-motion handling work over HTTPS.                                                                                                                            |
| Worker restart        | Restart `worker` using the same Compose flags; request a real test email and confirm queued work completes.                                                                                                                    |
| API restart           | Restart `api`; existing login and private bank/receipt data still work.                                                                                                                                                        |
| Load                  | On disposable staging data, try the expected scan burst of up to 50 players, including retries; confirm no duplicate attendance, acceptable latency, no connection exhaustion or memory kills. Do not load-test real payments. |
| Recovery              | Restricted database export and restore into a separate database succeed; stable encryption/session keys are available to the authorised operator.                                                                              |

Review detailed flows in [production readiness](../production-readiness.md).
The server starts processes automatically after crashes/reboot via Docker's
restart policy, but Docker **does not restart a running process merely because
its health status is unhealthy**. Monitor readiness and worker failures
separately. Check `/management/operations`, email failures and disk usage.
Keep backups encrypted/restricted and outside the VPS; Supabase Free is not a
replacement for a tested backup/restore procedure.

## Updates and rollback

For each release: review/backup data, pull the exact tested commit, update
`IMAGE_TAG`, build `api`, run `preflight`, run `migrate`, then run `up -d` with
the same proxy option. Keep the previous image tag and commit. Both API and
worker must use the same release. Secrets/DNS changes are separate from code
updates; rebuild/recreate containers when environment changes.

Rollback only to an image compatible with the current database schema. Set
`IMAGE_TAG` to that retained image and run `up -d --no-build`; do not reverse or
rewrite an applied migration casually. Do not use `down -v`: it deletes Caddy's
certificate state. The application data remains in Supabase, not a VPS database
container. Docker log rotation is included; patch the VPS and container images
on an agreed schedule.
