# Signed-in browser sessions

Account → Signed-in devices is available to players and staff. Entries show an approximate browser/OS label, a server-derived “This device” badge, sign-in time, and last activity in Africa/Lagos time. A browser and installed PWA can have separate sessions. Labels do not establish device ownership or identity.

## Storage and migration

Deploy `20261015000000_device_sessions` before the new API. It adds a nullable `DeviceSession.deviceLabel` and an expiry index. Existing sessions and cookies stay valid and display “Unknown browser.” Newly issued HTTP login, verification, membership-switch, and invitation-acceptance sessions get a coarse label derived from the User-Agent. Unknown or oversized inputs also display “Unknown browser.” No raw User-Agent, IP-derived location, GPS, or device fingerprint is stored for this feature.

The worker's existing maintenance cycle deletes expired sessions; associated push subscriptions cascade away. Revoked, unexpired sessions remain unavailable and hidden until expiry. Ordinary login expiry remains 30 days.

## API and authorization

- `GET /api/v1/auth/sessions`: account-wide active, unexpired sessions, ordered by last activity descending, then ID descending. Cursor pagination is account-scoped. Returned fields are ID, label, authentication method, timestamps, and `isCurrent`; cookie values, token hashes, credentials, and raw client headers are excluded. Activity timestamps are refreshed at most once per minute. Sessions can move between pages as activity changes; Refresh starts a fresh list.
- `DELETE /api/v1/auth/sessions/:id`: revoke only an owned session, across the account's teams, and delete its push subscription in the same transaction. The UI confirms the selected label and handles revoking the current session by returning to sign-in. Access ends on the revoked session's next authenticated request.
- `POST /api/v1/auth/sessions/revoke-others`: accepts `{ "credential": "..." }`. Managers confirm their account password; players confirm their account PIN. An account-scoped limit permits five attempts per 15 minutes, including successful confirmations. Wrong credentials return `403 REAUTHENTICATION_FAILED` and do not sign out the current device. Successful confirmation revokes all other active, unexpired account sessions, removes their push subscriptions, records a count-only audit event, and returns `{ "revoked": number }`. The current cookie is retained. Account locking serializes this operation with session creation; a new login after revocation can still create a session normally.

Both mutation endpoints retain the existing cookie authentication, Origin, CSRF, and selected-membership protections. Credential inputs are kept only in component memory and cleared on successful confirmation or dialog dismissal. There is no automatic sign-out based on labels, location, or session count.

## Validation and release

Run `npm run db:generate`, backend tests, type checks, lint, frontend build, and `npm run test:web`. Integration tests cover labeling, expiry cleanup, pagination, credential guessing, account isolation, cross-team revocation, and subscription cleanup. Browser tests cover labels, legacy fallback, selected-session confirmation, and PIN/password confirmation with recovery from an incorrect credential.

Deploy the additive migration and API first, then the frontend. No secrets need to be added. On staging, use two browsers to confirm that revoking one ends only that session and that bulk sign-out preserves the initiating browser.
