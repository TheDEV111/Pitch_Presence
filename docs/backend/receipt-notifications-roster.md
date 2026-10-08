# Receipt notifications, dues search and player removal

## Staff device notifications

Coaches and managers opt in under **Account & devices → Receipt notifications**.
Permission is requested only when they press **Enable receipt notifications**.
Subscriptions apply to the current authenticated device session. They are never
enabled automatically for a new account on a shared browser.

A new PDF/PNG receipt creates one durable `PUSH_RECEIPT_SUBMITTED` job for each
subscribed, active, verified staff device in the same team. Jobs commit in the
receipt transaction; a retried upload adds no notifications. The existing worker
sends encrypted Web Push, retries transient failures up to five attempts, and
removes expired subscriptions on HTTP 404/410. Failure does not lose or approve a
receipt. Delivery is best effort and at least once; receipt tags and provider
topics collapse retries. The dues list remains the authoritative review queue.

Before delivery the worker checks team, staff role/verification/activity, session
expiry/revocation, VAPID version and pending receipt status again. Jobs older than
24 hours and reviewed receipts are skipped. Signing out or revoking a session
removes its subscription; maintenance removes expired records. Already accepted
pushes may arrive after sign-out, with generic content only.

Notifications say **New dues receipt**, without player names, amounts, bank
details or attachments. Tapping opens `/management/dues?month=YYYY-MM` behind the
normal authentication/team checks. Links are restricted to this same-origin
page. No authenticated data enters service worker caches. A capability handshake
prevents enabling push using an old service worker; close all app windows and
reopen to finish an update.

Endpoints and browser encryption keys are encrypted using `DATA_ENCRYPTION_SECRET`
and are absent from API responses/job payloads. Endpoint validation allows known
HTTPS FCM, Mozilla, Apple and Windows providers only, rejecting internal hosts,
credentials, custom ports and lookalike hosts. Sensitive provider exceptions are
discarded before logging. Writes require staff authentication, a team and CSRF.

### Setup

```sh
npm run db:deploy
npm run push:setup -- mailto:your-monitored-contact@your-domain.com
```

`push:setup` generates a VAPID pair in the ignored root `.env` without printing
keys, and preserves an existing pair. Without an argument it derives the contact
from `EMAIL_FROM`; replace `VAPID_SUBJECT` with a monitored contact for production.
Keep identical `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and
`DATA_ENCRYPTION_SECRET` on API and worker, then restart both. The public key is
served by the authenticated settings API; the private key is server-only.
VAPID rotation requires devices to opt in again. No paid notification SaaS or
Firebase project is required by this implementation.

Production requires HTTPS and user permission. On iPhone/iPad, add the app to the
Home Screen and open its icon on iOS/iPadOS 16.4 or later. Browser/OS settings and
connectivity govern alert delivery and sound. See [Apple Web Push guidance](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
and the [Web Push library](https://github.com/web-push-libs/web-push).

| Method | Route                                   | Result                                                              |
| ------ | --------------------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/v1/management/notifications/push` | Availability, public key and current session's subscription status. |
| POST   | `/api/v1/management/notifications/push` | Register `{endpoint,keys:{p256dh,auth}}` for this session.          |
| DELETE | `/api/v1/management/notifications/push` | Disable this session's delivery.                                    |

## Search dues

**Search player name** sends a debounced, URL-encoded `search` query to
`GET /api/v1/management/dues`. The server performs a case-insensitive substring
search inside the manager's team, selected month and payment status, before
pagination. Search is capped at 100 characters; changing filters resets loaded
pages. All eligible players are searched, including unloaded records.

## Remove a player

Temporary **Deactivate** and terminal **Remove from team** are separate actions.
Removal needs confirmation and the staff-only, team-scoped
`POST /api/v1/management/players/:id/remove`. It locks the player, sets `removedAt`
and `active=false`, revokes all sessions, consumes outstanding verification/reset
challenges and records one `PLAYER_REMOVED` audit event. Retry is idempotent.
Managers and other teams' players cannot be removed through this route.

Removed players leave the default roster. **Include removed players** sends
`includeRemoved=true` to show retained, read-only records. Activate/name editing
are blocked. The old team ID remains for payment, receipt and attendance foreign
keys, without granting current access. The unique-email model does not yet offer
joining another team or restoring a removed account. Use Deactivate for temporary
absence. Existing records stay available to staff; dues cover the removal month
and earlier eligible months, with no subsequent dues generated for this membership.
Removal does not refund payments or cancel provider transactions already created.

Correct PIN sign-in returns HTTP 403, `PLAYER_REMOVED`, and:

> You have been removed from your team. Contact your coach or manager for help.

Incorrect credentials retain generic login failure. An unexpired old device token
receives the specific error on protected routes; the frontend clears the workspace
and shows **Your team access has ended**. Public sign-in remains usable even with
the old cookie. Outstanding OTPs cannot reactivate a removed membership.

## Verification and release acceptance

Automated coverage includes team boundaries, subscription confidentiality,
upload retry deduplication, provider retry/expiry, revoked/disabled devices,
shared-browser ownership changes, search pagination, removal retry/login errors
and OTP prevention. Service worker tests cover generic content and trusted clicks.
Browser journeys cover consent/disable, search, removal and access-ended screens.

Local validation passed 148 automated tests (six environment-dependent skips),
backend/frontend builds, TypeScript, lint and formatting. Browser journeys were
discovered but could not execute: the preview server is blocked by
`listen EPERM` on `127.0.0.1:3000` in this session. The two new migrations were
validated on the isolated test database; deploy them to the intended Supabase
database before testing the app. Local VAPID keys were generated without logging
their values. Actual device delivery has not yet been verified.

Still test actual HTTPS devices: opt in as staff, upload as a player, observe the
lock-screen alert, tap into the correct dues month, sign out and confirm new
submissions do not notify that session. Repeat on Android and an installed iPhone
app, with the worker running and outbound push-provider access available.
