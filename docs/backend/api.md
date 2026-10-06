# API integration guide

Base path: `/api/v1`. The generated [OpenAPI reference](openapi.json) lists routes, request schemas, major response contracts and error shapes. All current routes return HTTP 200 on success. Requests reject unknown mutation fields; body size is capped at 64 KiB.

## Cookie authentication

Serve web and API under one public HTTPS origin. Cookies are host-only, HttpOnly, SameSite=Lax and Secure in production (`__Host-pitchpresence`). Development uses `pitchpresence` without Secure. Use `credentials: 'include'` for fetch calls. Do not store the device token in browser storage.

Email verification and device login return `{user, team, nextStep, csrfToken}`. Refresh CSRF state through `GET /auth/me`. Every browser mutation must send `Origin` matching `APP_URL`; authenticated mutations also require `X-CSRF-Token`. The Paystack webhook uses its signature instead. An API response never returns the cookie token in JSON.

## Staff and player onboarding

1. Staff submit `POST /auth/staff-register` with `{name, email, password}`. Passwords are 15–128 characters; request roles/team IDs are rejected.
2. Verify through `POST /auth/verify-email` with `{email, otp}`. `nextStep` is `CREATE_TEAM`, `ACCEPT_INVITATION`, or `READY`; `/auth/me` preserves it across devices.
3. `POST /teams` accepts `{name}` for verified unassigned staff. The dashboard's players, dues and bank tasks are optional and resumable.
4. Staff sign in through `POST /auth/staff-login` with `{email,password}`. Recovery uses `/auth/password-reset/request` then `/auth/password-reset/confirm` with `{email,otp,password}`; reset revokes all devices and requires login again.
5. Managers create `POST /management/staff-invitations` with `{email}`. Invite links use `/staff/join?invite=…`; signup includes `invitationToken`. Existing unassigned staff can sign in and accept with `POST /auth/staff-invitation/accept` `{token}`. Newly registered invitees may accept `{}` using their stored pending invitation. Acceptance is email-bound and single-use. `/auth/staff-invitation/decline` clears a pending invitation so the account can create its own team.
6. Player links from `POST /management/invitations` remain reusable for seven days. `/auth/register` takes `{name,email,pin,invitationToken}` and always creates PLAYER in the issuing team. Players use `/auth/device-login` with email/PIN and the existing `/auth/pin-reset/*` recovery routes.

`GET /invitations/preview?token=…` returns team name, kind, bound email and expiry for an active invitation. Raw tokens are returned only at creation and encrypted in email jobs. `GET /management/staff` and `/management/staff-invitations` list this team's staff and invitations. `DELETE /management/invitations/:id` revokes either kind in the caller's team.

## Dashboard and bank setup

`GET /management/overview` returns team, currentSession, five recentSessions, complete players `{active,total}`, dues `{month,paid,unpaid,minimumAmount}`, and setup flags. `GET /management/team` returns team, paymentsReady, masked paymentProfile and latestSetup.

- `GET /management/banks`: Nigerian NGN bank options.
- `POST /management/bank/resolve`: `{bankCode,accountNumber}` returns `accountName`.
- `POST /management/bank`: `{bankCode,accountNumber,accountName,password}` reauthenticates, resolves again and creates a new destination after the client confirms its details. An account name match is not proof of ownership.
- `POST /management/bank/reconcile`: `{}` reads provider correlation metadata to resolve PENDING/REVIEW, without creating another subaccount.

All management calls require team membership. Setup returns READY or REVIEW details; a reviewed replacement leaves the previous active profile in place. Only last four digits and account name are public; raw account number/password are never persisted. Checkout requires a READY team profile; no fallback to the platform bank. Team commission is zero and team pays provider fees.

`GET /management/banks` loads all cursor pages from Paystack's [List Banks API](https://paystack.com/docs/api/miscellaneous/#list-banks), restricted to Nigeria and NGN. Only active, non-deleted `nuban` entries are exposed, sorted by name and deduplicated by bank code. The server-only `PAYSTACK_SECRET_KEY` is required, including for loading the dropdown. The UI offers loading, empty and retry states. Select a bank, resolve the ten-digit account number, confirm the account name and authorisation, then reauthenticate to connect the team's Paystack subaccount.

OTP expires in ten minutes and permits five attempts. Resend has a 60-second cooldown and five-send hourly account cap. Resend/reset requests have a shared IP cap. Login permits five failed account attempts per 15 minutes and 30 IP attempts per 15 minutes.

## Training and check-in

```json
{
  "name": "Morning training",
  "latitude": 6.5244,
  "longitude": 3.3792,
  "locationAccuracy": 25,
  "locationCapturedAt": "2026-10-02T06:00:00.000Z"
}
```

Submit fresh device readings to `POST /training-sessions`. The timestamp above is illustrative; an actual request must use a capture within the preceding two minutes.

Request `POST /training-sessions/:id/qr-token` with `{}`. Tokens are valid for 30 seconds from issuance; refresh the display every 10 seconds. Render a web URL such as `/check-in#token=<encoded-token>` in the QR. A fragment avoids sending the QR token to web-server logs. The landing page extracts it, removes it from browser history and submits `POST /attendance/check-in` with `{token}` after authentication. Preserve it in memory across login; if expired, request a new scan. Do not write attendance in a GET request.

Success returns `{attendance, alreadyRecorded}`. Poll the manager attendance endpoint every five seconds. `POST /training-sessions/:id/attendance/manual` accepts `{playerId}`. `POST /training-sessions/:id/close` immediately closes the window. Repeated closure succeeds without adding another audit event.

## Dues and checkout

Management configures `PUT /management/dues-periods/:month` with `{minimumAmount: 10000}` (NGN 100.00). Player-entered checkout amounts use integer kobo. `GET /me/dues` includes minimumAmount, paymentsReady, paymentAvailable, payment history and month status.

```http
POST /api/v1/payments/paystack/initialize
Idempotency-Key: checkout-2026-10-001
X-CSRF-Token: <from-auth-me>
Content-Type: application/json
```

```json
{ "month": "2026-10", "amount": 15000 }
```

Redirect to checkoutUrl when present. If initialization is pending without a URL, poll `/payments/:id` when an ID is known; otherwise retry the identical initialization request with the same key to recover its local record. Do not generate a different key to work around an unresolved provider result. After redirect, `POST /payments/:id/verify` requests server verification. Current-month and previous-month payments follow the same rules.

The callback URL is `${APP_URL}/dues/payment-return?paymentId=<uuid>`. The frontend callback page verifies server state and must not trust provider query parameters as proof of payment.

Manual confirmation: `POST /dues/:id/mark-paid` accepts amount and optional externalReference. Reversal: `POST /dues/:id/reverse-manual-payment` accepts paymentId and a reason of at least five characters. Both are manager-only.

## Collections and errors

Training is ordered by descending start time and UUID; its cursor must belong to the caller’s team. UUID-based collections accept `cursor` and `limit` (default 25, maximum 100), returning `{items, nextCursor}`. Dues history and dues-period configuration lists use `YYYY-MM` cursors in descending month order. Management dues uses UUID cursors and supports month/status filters. Live attendance returns a complete session roster.

```json
{
  "error": {
    "code": "QR_EXPIRED",
    "message": "Scan the QR currently displayed by management.",
    "requestId": "req-123"
  }
}
```

Relevant codes: TEAM_REQUIRED, TEAM_ALREADY_ASSIGNED, INVITATION_PENDING, TEAM_PAYMENTS_UNAVAILABLE, BANK_REVIEW_REQUIRED, REAUTHENTICATION_FAILED, ACCOUNT_NAME_CHANGED, AUTHENTICATION_REQUIRED, FORBIDDEN, CSRF_INVALID, INVITATION_INVALID, OTP_INVALID, LOGIN_FAILED, RATE_LIMITED, QR_EXPIRED, QR_INVALID, SESSION_CLOSED, SESSION_ALREADY_OPEN, PLAYER_INELIGIBLE, DUES_PERIOD_UNCONFIGURED, DUES_PERIOD_FROZEN, DUES_ALREADY_PAID, PAYMENT_AMOUNT_BELOW_MINIMUM, PAYMENT_PENDING, IDEMPOTENCY_CONFLICT, PAYMENT_INITIALIZATION_UNRESOLVED and PAYMENT_VERIFICATION_MISMATCH.

Players can read only their own records. Unknown or foreign payment IDs return 404. Management audit and operations endpoints are manager-only. Webhook acknowledgments mean durable receipt; settlement is asynchronous through the worker.

Every team-scoped read or mutation derives its team from the cookie session. Foreign record lookups return 404; foreign QR claims are invalid and manual attendance rejects unavailable or cross-team players with 403; client-supplied tenant IDs cannot select a team. Operations counts and audits cover only the caller’s team. External payment histories use provider `EXTERNAL`, never `MANUAL`.
