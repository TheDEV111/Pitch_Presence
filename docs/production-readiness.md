# PitchPresence production readiness

Reviewed against the working tree on 9 October 2026. This document records
implemented features, remaining release gates and validation evidence.

## Implemented and available to test

| Area                | Current implementation                                                                                                         | Remaining acceptance                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Staff access        | Password sign-in, email verification, recovery, resumed onboarding, team creation and email-bound staff invitations.           | Deliver real emails and complete interrupted signup/recovery over HTTPS.                                                       |
| Player access       | Team invitations, verification, four-digit PIN sign-in and PIN recovery.                                                       | Complete a real invitation journey and remembered-device login on a phone.                                                     |
| Training attendance | Coach GPS session creation, rotating 30-second QR, player location checks, live roster, manual attendance and session closure. | Test outdoor accuracy, native-camera scanning, expired codes, duplicate scans and closure on real phones.                      |
| Dues and banks      | NGN dues, manual transfer accounts, private receipt uploads, staff review, audit/reversal and retained Paystack integration.   | Test real transfers, PDF/PNG proof submission, staff review and email-confirmed bank changes. Paystack acceptance is deferred. |
| Background jobs     | Durable database-backed email/payment jobs, leases, retries and reconciliation maintenance.                                    | Select a host that actually runs the worker, test crash recovery and monitor failures.                                         |
| Frontend and PWA    | Role workspaces, installation launch, public-only offline screen, update guidance and safe media fallbacks.                    | HTTPS Android/iOS installation, offline/update flows and signed-in navigation.                                                 |
| Release media       | Clean 15-second football exports, local fonts/icons/photos and desktop/tablet split-panel video.                               | Browser/device review of crops, autoplay, pause, reduced motion and media failure.                                             |
| Data                | Prisma migrations and Supabase connection/setup instructions. User reported migration status up to date.                       | Recheck the intended deployment database, credentials, SSL, test/live separation and restore procedure.                        |

The latest local backend build, lint, formatting and TypeScript checks passed.
The full automated suite passed 158 tests and skipped six: five require a
dedicated PostgreSQL test database and one requires current FFmpeg tooling.
The guarded frontend build and asset checks also passed. Both imported MP4s
decoded to 360 frames over 15 seconds. Browser execution was blocked by
`listen EPERM` in this session; test discovery does not count as a passed browser
run. Docker execution was blocked by inaccessible daemon permissions. Latest
remote CI results and deployed provider/device results must be recorded separately.

## 1. Finish the code release

- Apply the receipt-push and player-removal migrations. Device alerts require
  VAPID configuration shared by API and worker, staff permission, and real HTTPS
  Android/iPhone acceptance. See [notification and player controls](backend/receipt-notifications-roster.md).

- Commit and push the new media, split-panel changes and deployment documentation.
- Confirm **Monorepo checks** passes for that exact commit, including browser
  journeys and real dedicated PostgreSQL concurrency tests.
- Run the guarded media build with `REQUIRE_LOCAL_MEDIA=true` and
  `NEXT_PUBLIC_LOCAL_FONTS=true`; retain local media in the deployed frontend.
- Keep ZIP archives, `.env`, provider secrets, source masters and test reports out
  of public assets and the deployment image.

The root Dockerfile now installs from all workspace package manifests and builds
only the shared/database/API workspaces. It starts only the API, not the frontend
or worker. Build the container in CI or on a machine with a usable Docker daemon;
this session cannot access the Docker socket. No image build has been verified here.

## 2. Select hosts and keep the worker operational

The selected backend host is now a friend's VPS; frontend remains on Vercel and
PostgreSQL on Supabase. Follow the [VPS handoff](backend/vps-handoff.md) for private
environment setup, API/worker supervision, HTTPS and acceptance. The VPS OS,
available resources, existing reverse proxy and public domains still need confirmation.

Public frontend/backend URLs have not been supplied in this session. Confirm any
existing projects before creating new ones. The current deployment shape is:

```text
Browser → public HTTPS frontend → /api/* proxy → Fastify API → Supabase PostgreSQL
                                                   ↑
                                  Separate continuous worker → Resend / Paystack
```

Next.js needs a host that runs its server/proxy, not just a static upload. Start
the API with `node apps/api/dist/server.js` and the worker with
`node apps/api/dist/worker.js` from the same backend release. Arrange automatic
restart and graceful shutdown for both. Do not expose a public unauthenticated
endpoint that runs jobs.

The budget remains free services using the supplied VPS. The following limits
explain why sleeping alternatives were not selected:

- **Render Free is a pilot option with availability limits.** Web services sleep
  after 15 minutes without inbound traffic and take about a minute to wake.
  Background-worker service types are not free. The current worker cannot be
  deployed as a separate free Render worker. [Render free-instance documentation](https://render.com/docs/free)
- A five-minute scheduled job is not an adequate replacement for immediate email
  OTP delivery. Scheduled reconciliation alone does not cover all worker duties.
- Putting the worker in a sleeping service also suspends processing while idle.
  An API request returning successfully does not prove its queued email was sent.
- **Vercel Hobby** is limited to personal/non-commercial use. Confirm eligibility
  if considering it for the frontend; the app's revenue model has not been
  established here. [Vercel terms](https://vercel.com/legal/terms)
- **Supabase Free** can pause for inactivity and requires a separate export/restore
  arrangement. Do not promise continuous availability or paid-plan recovery
  features on a free deployment. [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)

An always-running host for both API and worker avoids the sleeping-worker issue.
Moving processing to a serverless/event-driven host would be additional development
and must preserve durable jobs, leases and prompt OTP delivery. The VPS is selected,
but neither process has been deployed by this review.

## 3. Configure HTTPS and deployment environment

| Process         | Configuration                                                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API and worker  | `NODE_ENV=production`, `DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, `QR_SIGNING_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `DATA_ENCRYPTION_SECRET`, `PAYMENT_MODE=MANUAL`, `LOG_LEVEL`. The API also uses the host's `PORT` and explicit `TRUST_PROXY` addresses/CIDRs where appropriate. |
| Frontend server | `API_URL` pointing to the deployed API.                                                                                                                                                                                                                                                  |
| Frontend build  | `NEXT_PUBLIC_LOCAL_MEDIA=true`, `NEXT_PUBLIC_LOCAL_FONTS=true`, `REQUIRE_LOCAL_MEDIA=true`.                                                                                                                                                                                              |

Set `APP_URL` to the exact public frontend HTTPS origin; it supplies invitation
links, payment return URLs and origin validation. Keep provider/database secrets
on the backend and worker host. `API_URL` belongs to the frontend server/build
environment, not browser JavaScript. Next.js rewrites must be built using the
correct backend URL. Deploy again when that URL changes.

Proxy `/api/*` through the frontend so cookies remain on the browser's origin.
Verify `Origin`, `Cookie` and `Set-Cookie` survive the hosting proxy. API health
URLs are `/api/v1/health/live` and `/api/v1/health/ready`. A ready database probe
does not prove email, checkout, worker or frontend health.

Apply committed migrations with `npm run db:deploy` against the intended database
as a controlled release task. Never reset data or use development migration
commands during production startup. Check the migration status before deployment
and keep test databases distinct from team records.

## 4. Test manual transfers and email delivery

- **Resend:** use the verified `app.kairos-devs.com` sender domain and an allowed
  `EMAIL_FROM`. Verify OTPs, recovery and staff invitations reach real recipient
  inboxes while the deployed worker is running.
- **Manual payments:** follow the [manual payment acceptance steps](backend/manual-payments.md).
  Verify email-confirmed bank additions/replacements/removals, real transfers,
  private PDF/PNG uploads, approval, rejection and audited reversal. Receipt
  submission alone must leave the month unpaid. Keep the data encryption secret
  stable and include it in the restricted recovery procedure.

Paystack setup is paused at the user's request. The following checks apply only
when online checkout is enabled again:

- **Paystack test:** complete bank list/resolution, team destination setup,
  reauthentication, checkout, return-page verification and signed-webhook
  settlement. Set the webhook to
  `https://<frontend-origin>/api/v1/payments/paystack/webhook`.
- Verify a lost callback or interrupted browser does not lose a settlement, and
  repeating verification does not duplicate payment records. Confirm both roles
  see the same dues state.
- **Paystack live:** business approval was previously pending. Confirm its status,
  configure live credentials in the host's secret store and use a live destination;
  test subaccount identities do not become live destinations automatically.
- Complete one controlled live payment and confirm its actual destination before
  inviting the team to pay. Provider success must be verified server-side.

Do not paste credentials into documentation, public files, GitHub issues or browser
configuration. These steps do not require sharing their values in chat.

## 5. Test the deployed app on real devices

Use one coach/manager account and two player accounts for the first staged session.

1. Register staff, receive verification, leave the page and resume onboarding.
   Create the team; verify password sign-in and recovery.
2. Invite players and another coach. Verify role separation, PIN access and
   email-bound invitation acceptance.
3. On an outdoor pitch, create training with accurate coach location. Scan the
   live QR from Android and iPhone, check arrival times, reject duplicates/expired
   codes, try manual attendance and close the session.
4. Test dues/provider behaviour using the previous section's test/live gates.
5. Install the PWA, launch into the correct workspace, try offline navigation and
   reconnect, and update with two app windows open.
6. Review tablet/desktop split videos, reduced motion, phone layout, manual pause
   and slow-network media/API recovery. Use actual browsers as well as CI emulation.

The expected training load is at most 50 players, once or twice weekly. After
small-group acceptance, test simultaneous check-in/repeated requests at that scale
against a dedicated staging team. Tests must not rewrite real team/payment history.

## 6. Operational launch gate

- Designate someone to check failed jobs, old pending payments and provider errors.
  `/management/operations` exposes team-scoped queue/payment counts.
- Set up availability alerts for the public frontend and API readiness, and verify
  the worker's processing separately.
- Export the database to a restricted location and rehearse restoring into a
  separate database. Record the recovery process and acceptable data-loss window.
- Record a known-good deployment commit and compatible rollback instructions.
  Never rewrite applied migrations to make a rollback appear successful.
- Launch only after CI, HTTPS cookies, real email, attendance, intended payment
  mode, worker recovery, PWA/device checks and backup/restore have evidence.

## Next work

Complete the VPS handoff and deploy an HTTPS test environment
with manual payments enabled. Complete real-device, email and receipt-review
acceptance there. Paystack approval and live settlement are deferred until online
checkout is resumed.
