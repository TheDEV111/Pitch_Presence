# Staging setup and testing

Staging is a separate copy of PitchPresence for testing releases with disposable
teams. It shares source code with production, **not databases, credentials,
accounts, uploaded files, jobs, or browser origins**. This guide describes setup;
committing these files does not create hosted services or DNS records.

| Resource       | Production                   | Staging                                          |
| -------------- | ---------------------------- | ------------------------------------------------ |
| Git branch     | `main`                       | `staging`                                        |
| Frontend       | Existing Vercel project      | New `pitch-presence-staging` project             |
| Website        | Existing production domain   | `https://staging.pitch-presence.kairos-devs.com` |
| API and worker | Existing Coolify application | New Coolify application                          |
| API address    | Existing production API      | `https://staging-api.kairos-devs.com`            |
| Database       | Existing Supabase project    | New `pitchpresence-staging` project              |

Public access does not mean unrestricted testing: ordinary app authentication
still applies, and only exact approved email addresses can register, sign in,
request recovery, receive staff invitations or perform authenticated mutations.
Removing an address from the allowlist blocks subsequent writes and deliveries;
it does not erase its test records. Session revocation and logout remain usable.
Search-indexing exclusions discourage indexing; they are not access controls.

## 1. Confirm VPS capacity with the owner

Ask the owner to inspect available memory, CPU, disk, production container usage,
and Docker build peaks. Read-only examples on the VPS:

```bash
free -h
df -h
docker stats --no-stream
docker system df
docker network inspect coolify -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

Do not prune images, stop production or change its configuration to make room.
The owner must choose `STAGING_API_MEMORY_LIMIT`, `STAGING_API_CPUS`,
`STAGING_WORKER_MEMORY_LIMIT` and `STAGING_WORKER_CPUS` from actual spare capacity.
Compose requires these explicitly. Runtime limits do not limit Docker builds;
schedule builds separately from production and watch memory during the first
deployment. If capacity is insufficient, postpone the staging backend.

## 2. Create the staging database

1. Check that your Supabase account has another free project slot. Create
   `pitchpresence-staging` near the VPS region. Do not duplicate the live database.
2. Disable the Data API. Follow the fresh-project and database-role instructions
   in [Supabase setup](backend/supabase.md), but run SQL **only in this new project**.
   Use the separate `pitchpresence_app` role and a new password. Automatic RLS can
   remain enabled; authorization continues through our backend.
3. Copy the staging **Session pooler** URI (port `5432`) and use
   `pitchpresence_app.STAGING_PROJECT_REF` as its username. Add `sslmode=require`.
   The staging guard accepts this role or `postgres`, with session pooler or direct
   Supabase connections. Transaction pooler port `6543` is rejected.
4. Record the staging project reference and the existing production reference.
   A reference is the 20-letter project identifier, not a password or API key.
   They must be different. No production password is needed for staging.

The staging guard requires the database URI to match its approved project and
restricts query parameters to TLS, connection/pool timeouts, connection limits
and the `public` schema. Do not add proxy-host overrides. A wrong reference or
destination stops the API **before Prisma migrations**. This protects against
configuration mistakes, not an administrator deliberately replacing both the
reference and URI. Compare project references independently in the dashboard.

Free projects may pause after inactivity. Resume staging in Supabase before a
test session; do not add artificial traffic solely to prevent provider pausing.

## 3. Prepare secrets and test addresses

Use [the backend template](../deploy/staging/backend.env.example). Enter real
values directly into the NEW staging application's private Coolify environment.
Do not change the local root `.env` or copy production secrets into the template.
Never commit a completed environment file or paste keys into chat or issue logs.

- Generate three fresh independent secrets, running `openssl rand -hex 32` once
  per secret. Do not reuse production's session, data-encryption or QR keys.
- Create a separate Resend API key for staging and a sender under your existing
  verified email domain. API keys on the same provider account may share quotas;
  a separate key is not a separate billing allowance.
- Set `STAGING_EMAIL_ALLOWLIST` to comma-separated exact tester addresses. No
  wildcards. Matching is case-insensitive; `name+test@example.com` must be listed
  separately from `name@example.com`. Changes require restarting/redeploying both
  API and worker. Email subjects include `[STAGING]`.
- For device notifications generate a **new** VAPID pair with the command below,
  which prints the pair without changing any environment file. Save its output
  privately and set `VAPID_SUBJECT=mailto:YOUR_CONTACT_ADDRESS` separately. Transfer
  these values only into staging and use the same pair in its API and worker.
  Initially all three VAPID values may be blank, but push testing requires
  configuring them together. Do not use `npm run push:setup` for this staging
  preparation: that helper edits the existing root `.env` or reuses its keys.
- Keep manual payments. Staging Compose forces `PAYMENT_MODE=MANUAL`, no Paystack
  secret, and `MULTI_TEAM_ENABLED=true`. Use fake team bank details and clearly
  marked sample receipts, never actual transfers.
- Set the actual proxy CIDR from step 1, not an unrestricted trust setting.

Optional VAPID generation from the repository root (requires installed dependencies):

```bash
node --input-type=module -e 'import webpush from "web-push"; const keys = webpush.generateVAPIDKeys(); console.log("VAPID_PUBLIC_KEY=" + keys.publicKey); console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);'
```

API checks reject unapproved request emails before accounts, challenges or
invitations are created. The worker checks recipients again at delivery. Blocked
jobs fail once with `STAGING_EMAIL_NOT_ALLOWED`, clear their sensitive payload
and are not retried. Add the address and request a **new** OTP/invitation to retry.
Never bypass verification or log OTPs to make staging easier.

## 4. Prepare the branch and Coolify application

From a clean, reviewed checkout with the staging implementation committed:

```bash
git fetch origin
git switch -c staging origin/main
git push -u origin staging
```

If these changes are still on a feature branch, merge that reviewed commit into
the new staging branch before deployment. If `staging` already exists, check it
out instead of creating it again. Do not merge untested features into `main`
merely to make the staging branch.

Create a **new** Docker Compose application in Coolify:

- Repository: the existing PitchPresence GitHub repository.
- Branch: `staging`.
- Compose file: `docker-compose.staging.yaml`.
- Domain: `https://staging-api.kairos-devs.com`, assigned to `api`, port `4000`.
- Variables: the private staging values from step 3; `STAGING_IMAGE_TAG` should
  be the exact source commit SHA. Disable automatic deployment initially.
- Leave the worker without a public domain. It starts after the API is healthy.

Create the API DNS record in Cloudflare pointing to the VPS, following the same
proxy/TLS arrangement as the existing working API. Confirm HTTPS works. Staging
uses unique Compose/image names, its own default network and no host port
publishing. The shared `coolify` network is used only for proxy routing.

Optional validation from a private file on the VPS (do not print rendered
configuration, which includes secrets):

```bash
docker compose --env-file /PRIVATE/PATH/staging.env -f docker-compose.staging.yaml config --quiet
```

After CI passes, deploy the new Coolify application. Startup validates the
configuration before applying committed migrations to the **empty staging
database**. The worker independently runs the same configuration validation.
Do not run a standalone `prisma migrate deploy` or root `npm run db:deploy` from
your laptop's existing `.env` for staging; those bypass the deployment guard.
No additional database migration is introduced by the staging feature itself.

Check migration completion in the staging logs and readiness:

```bash
curl --fail https://staging-api.kairos-devs.com/api/v1/health/ready
```

Expect `{"status":"ready"}`. A failed staging database/configuration must not
be "fixed" by pointing it at production.

## 5. Create the separate Vercel project and frontend DNS

1. Import the same GitHub repository as a NEW project named
   `pitch-presence-staging`. Do not edit the existing live project.
2. Use the settings in [Vercel deployment](frontend/vercel-deployment.md): root
   `apps/web`, Node 22, include files outside the root, and the committed build
   and install commands.
3. Set this project's **Production Branch / Branch Tracking** to `staging`.
   Vercel calls the stable deployment of each project "Production"; this project
   still serves our staging app. Its initial import may build the default branch;
   do not use it until these settings and environment values are applied.
4. Set the **Ignored Build Step** override to
   `node ../../scripts/vercel-staging-ignore.mjs`. Exit `1` builds `staging`;
   exit `0` skips other branches and CLI deployments without a Git branch.
5. Set the values in [the frontend template](../deploy/staging/frontend.env.example)
   for this new project's Production environment. Keep API secrets out of Vercel.
6. Add `staging.pitch-presence.kairos-devs.com` in Vercel Domains. Add exactly the
   DNS record Vercel displays in Cloudflare, set that frontend record to **DNS
   only** (grey cloud), and wait for Vercel HTTPS validation. This nested hostname
   is outside the usual first-level coverage of Cloudflare Universal SSL in a
   full zone setup; DNS-only lets Vercel serve its certificate directly without
   buying an additional Cloudflare certificate. See
   [Cloudflare certificate coverage](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/).
7. After the staging API is ready, deploy the exact reviewed `staging` commit
   through the Git integration or Vercel dashboard. `API_URL` is read at build
   time; changing it requires another build. The staging frontend refuses to
   build with a non-staging API destination.
8. Verify the amber staging banner, noindex metadata/headers, landing media and
   the proxied `/api/v1/health/ready` URL through the staging frontend domain.

Until the first paired release is verified, prevent pushes during setup and
manually trigger the initial staging frontend deployment after the API. Vercel's
Git integration will build later staging pushes automatically; leave Coolify
manual until its isolation/resource checks are complete. Do not assume that a
Git push means CI passed or that both services deployed the same commit.

## 6. First acceptance session

Use a separate browser profile and approved inboxes. Generate invitation links
inside staging; production invitations are intentionally invalid in its database.

- Manager: signup, OTP verification, refresh recovery, team creation, staff invite.
- Player: invitation registration, refresh before/after registration, OTP expiry,
  login, reopen an invitation for an existing membership.
- Memberships: one account with roles in separate test teams, switching, stale-tab
  protection, player removal and the specific removed-player error.
- Attendance: real-phone GPS, opening/closing training, QR expiry and check-in.
- Dues: manual bank-change email confirmation, sample PDF/PNG upload, pending
  indicator, manager review, paid status and player-name search.
- Profiles: photo upload/remove, preferred foot/positions, coach access and team isolation.
- Devices/PWA: installation, offline view, device revocation and receipt push alerts.
- Restrictions: unapproved email receives HTTP 403 `STAGING_EMAIL_NOT_ALLOWED`,
  no account/job created, no email delivered. Production-origin writes are rejected.
- Isolation: staging test teams/receipts never appear in production; production
  cookies cannot authenticate staging; notification subscriptions stay separate.

Do not point automated integration tests at staging: `npm test` uses embedded
PostgreSQL, or an explicitly disposable `TEST_DATABASE_URL` only. Record browser
errors using status, structured error code and request ID, not tokens or cookies.

## 7. Release and rollback

Use feature branch -> reviewed PR to `staging` -> CI -> staging acceptance ->
reviewed PR to `main`. Prefer merging without rewriting tested commits where
possible, and record both deployed SHAs. Promote source and migrations, not test
data, staging credentials or staging platform settings. Feature changes should
support backend-first deployment; frontend deployment success alone is insufficient.

Initially deploy the staging backend manually after CI, then the matching
frontend. If automatic deployment is later enabled, configure a CI-aware rollout
and branch protection first; plain push-triggered deployments can race CI.

Keep production's existing release process. Staging does not remove the need for
production backups or caution with data migrations. For a failed release, roll
back application images only if compatible with the current schema. Never
automatically reverse migrations. A destructive staging rebuild requires stopping
only its worker/API and separately confirming the staging project identity.

## Completion record

Before calling staging ready, record (without secrets): owner-approved resource
limits, both Supabase project references, staging service names, deployed commit
SHAs, HTTPS/readiness checks, CI link, approved tester count, email and push
delivery results, and the date of the first successful full onboarding journey.

References: [Vercel Git deployments](https://vercel.com/docs/git),
[Supabase free project limits](https://supabase.com/docs/guides/platform/billing-faq),
[Supabase pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
[Coolify resource limits](https://coolify.io/docs/applications/configuration/resource-limits).
