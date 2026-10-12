# PitchPresence production acceptance

Prepared 12 October 2026. This is a test checklist, not a record of passing tests.
The user reported that both deployments are running. Public URL checks from this
session could not fetch the sites; availability has not been independently verified.

## Environment and test records

| Setting                     | Target                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| Frontend                    | `https://pitch-presence.kairos-devs.com`                           |
| Backend                     | `https://pitch-presence-api.futuredevs.com`                        |
| VPS `APP_URL`               | Exact frontend origin above                                        |
| Vercel production `API_URL` | Exact backend origin above                                         |
| Payment mode                | `MANUAL`                                                           |
| Database                    | Intended Supabase PostgreSQL database                              |
| Background processing       | Separate API and worker containers using the same release and keys |

Use a dedicated team named `PitchPresence QA — October 2026`. Keep test records
separate from the real team's attendance and dues. Do not reset the production
database. Start with these accounts, using inboxes you control:

| Alias | Role and purpose                                                               |
| ----- | ------------------------------------------------------------------------------ |
| C1    | Initial coach/manager; creates the test team                                   |
| C2    | Invited coach/manager; verifies staff invitations and shared management access |
| P1    | Player; successful attendance, receipt approval and ongoing access             |
| P2    | Player; rejection/retry, manual attendance, suspension and eventual removal    |
| C3/P3 | Optional separate test team for tenant isolation checks                        |

Use separate browser profiles/devices for staff and players. Keep C1's original
session available when testing other sessions. Remove P2 only after their other
test cases are complete. An installed PWA and its browser may share cookies on
the same device; use another device for a reliably separate account session.

Record frontend/backend commit identifiers, device/browser versions and date.
Use `NOT RUN`, `PASS`, `FAIL` or `BLOCKED` for each test. Keep passwords, codes,
cookies, invitation/QR tokens, bank numbers and private receipts out of reports.

## 1. Connectivity and deployment

| ID     | Action                                                               | Expected result                                                                                  |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| NET-01 | Open backend `/api/v1/health/live`.                                  | HTTP 200, `{"status":"ok"}`.                                                                     |
| NET-02 | Open backend `/api/v1/health/ready`.                                 | HTTP 200, `{"status":"ready"}`; the database is reachable.                                       |
| NET-03 | Open frontend `/api/v1/health/ready`.                                | Same HTTP 200 response through Vercel's API rewrite.                                             |
| NET-04 | Open the frontend, sign-in pages and a missing page.                 | HTTPS works, navigation stays on the frontend, and a useful missing-page screen appears.         |
| NET-05 | Have the VPS operator confirm migration status and container status. | All committed migrations are applied; API and worker use the same release; no repeated restarts. |

Stop dependent testing if NET-02 or NET-03 fails. A healthy API/database response
does not establish email or push delivery; those require the cases below.

## 2. Staff authentication and onboarding

Start at `/signup` with C1.

| ID      | Action                                                                                            | Expected result                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| AUTH-01 | Submit a password shorter than eight characters, then one without the required character classes. | Invalid input is rejected; a valid password has 8–128 characters, uppercase, lowercase, a digit and a symbol. |
| AUTH-02 | Create C1's account and receive the email code.                                                   | Real email arrives; UI changes to six-digit verification; worker completes delivery.                          |
| AUTH-03 | After the verification form appears, refresh, leave for `/sign-in`, then continue verification.   | Email and cooldown recover; code/password are not restored; latest valid code succeeds.                       |
| AUTH-04 | Enter one wrong code, then the correct code; request a fresh code when resend becomes available.  | Wrong code gives a useful error; the valid latest code works; resend cooldown is enforced.                    |
| AUTH-05 | Verify C1, refresh before creating the team, then create the QA team.                             | Server-selected onboarding resumes; the dashboard opens; refreshing does not create another team.             |
| AUTH-06 | Sign out, sign in with a wrong password once, then the correct password; reload the dashboard.    | Wrong credentials fail clearly; correct credentials work; the session survives reload.                        |
| AUTH-07 | Use `/forgot-password`; complete email recovery and set a valid new password.                     | New password works, old password fails, and old device sessions lose access on their next server request.     |
| AUTH-08 | From Account, sign in on a second device and revoke that session from the first device.           | The second session loses access; the unrevoked first session continues to work.                               |

For interrupted signup, allow a successful response to reach verification before
testing recovery. Cancelling an in-flight request is a separate lost-response
case: use a subsequent normal sign-in/signup recovery attempt, and record what
actually happened rather than assuming the server rejected the first request.

## 3. Invitations, roster and access

Open `/management/team` for staff invitations and `/management/players` for
player invitations and roster controls.

| ID      | Action                                                                                                             | Expected result                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| TEAM-01 | Invite C2 at their exact email. Open the invitation, create/verify the account, refresh verification, then accept. | Invitation email arrives; raw token leaves the address bar; C2 joins the same team and can manage it. |
| TEAM-02 | Test a staff invitation with a different email, and a revoked invitation.                                          | The other email cannot accept it; revoked invitation gives an actionable error.                       |
| TEAM-03 | Create a player invitation and register/verify P1 and P2 using four-digit PINs.                                    | Both appear in the team roster; player login opens `/home`.                                           |
| TEAM-04 | Revoke a spare player invitation and open its saved link.                                                          | New registration with that link is blocked; already-registered players retain access.                 |
| TEAM-05 | As a player, open `/management`; as staff, open `/dues`.                                                           | The wrong role's workspace is blocked and offers navigation to the correct dashboard.                 |
| TEAM-06 | Edit P2's name, deactivate them, try their old session/PIN access, then activate them and sign in again.           | Name update persists; inactive access is blocked; temporary deactivation can be reversed.             |
| TEAM-07 | Recover P2's PIN from `/reset-pin`.                                                                                | Email recovery works; new PIN works; old PIN and old sessions lose access.                            |

Both coaches and managers currently use the `MANAGER` role and have full
management access. Limited coach permissions are not a separate feature.

## 4. Team bank details and monthly dues

Only use a bank account you are authorised to configure. For a real settlement
check, choose a small test amount yourself and verify the transfer with the bank
before approving it. UI receipt validation does not verify bank settlement.

| ID      | Action                                                                                                                         | Expected result                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| BANK-01 | Add bank name, account holder and ten-digit number; re-enter C1's password.                                                    | Change remains pending; a confirmation email arrives; players cannot use the proposed details before confirmation.               |
| BANK-02 | Refresh while confirmation is pending; enter one wrong code, then the correct code.                                            | Pending proposal recovers; wrong code does not activate it; correct code activates the account.                                  |
| BANK-03 | Try confirming C1's proposal from C2.                                                                                          | C2 cannot confirm another staff member's change.                                                                                 |
| BANK-04 | Replace the account and later remove it, confirming each by email.                                                             | Previous account stays active until confirmation; completed changes notify active staff; removal disables new transfer guidance. |
| BANK-05 | After removal, inspect a previous payment and submit proof for a transfer already made to an available historical destination. | Historical account/payment records remain available; old transfers can still be reviewed.                                        |
| DUES-01 | Select October 2026, save a chosen minimum as digits, e.g. `3000`; try comma-formatted or invalid input.                       | Numeric input displays correctly as NGN; unsupported input gives a useful error.                                                 |
| DUES-02 | After receipt/payment activity starts, try changing the month's minimum.                                                       | The minimum is fixed; changing it is blocked.                                                                                    |
| DUES-03 | Search P1 by partial name, switch Paid/Not paid, switch months, and clear the search.                                          | Name, month and status filters combine correctly; clear restores the list; no match gives a useful empty state.                  |

Perform bank addition, replacement and removal deliberately. Requests are limited
to three per staff member per hour and five per team per day; avoid repeated
wrong-password requests while testing. A newer proposal replaces the pending
code. Plan the removal case after the normal receipt/transfer cases, or keep the
remaining receipt's destination identifiable from account history.

## 5. Receipts and payment records

Use distinct files for distinct transfers. Keep test fixtures clearly labelled
and confined to the QA team. Test records must not be represented as genuine
payments in the real team's ledger.

| ID     | Action                                                                                                        | Expected result                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| PAY-01 | P1 chooses the month, amount and destination and submits valid PNG proof up to 2 MB.                          | Staff/player see Proof submitted; month remains unpaid until staff approval.                     |
| PAY-02 | Submit below the minimum, an unsupported file, a file larger than 2 MB and a corrupt PNG/PDF.                 | Validation explains the failure; no successful payment is created.                               |
| PAY-03 | Retry the same successful upload after a simulated lost response; try the same file for another player/month. | Same-submission retry returns the existing record; reuse elsewhere in the team is rejected.      |
| PAY-04 | P2 submits valid PDF proof. C1 downloads and rejects it with a reason.                                        | Download works; month stays unpaid; P2 sees the reason and can submit a corrected distinct file. |
| PAY-05 | C1 verifies the actual transfer and approves P1's receipt, then reloads both dashboards.                      | Both show the same paid month and amount; approval retries do not create another payment.        |
| PAY-06 | Record a direct external payment for an eligible QA record with no pending proof.                             | Staff confirmation updates the player's monthly status and leaves an audit trail.                |
| PAY-07 | Reverse a QA manual payment with a reason.                                                                    | Status recalculates; payment history/reversal and reason remain recorded.                        |
| PAY-08 | As P2, request P1's receipt download using the API path observed in DevTools.                                 | Another player's private receipt cannot be downloaded.                                           |

Receipts are capped at three submissions per month and five upload attempts per
player per hour. Use separate QA records or spread negative tests out so quota
errors do not hide the file-validation result you intended to test. Keep a
real-bank confirmation result separate from a fictional QA status-transition test.

Paystack checkout, bank resolution, webhooks and live settlement are deferred
while `PAYMENT_MODE=MANUAL`. They are not acceptance requirements for this release.

## 6. Training and attendance on real phones

Run outdoors with C1 and the two players present. Test C1's location permission
and accuracy before starting the normal session.

| ID    | Action                                                                                          | Expected result                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| QR-01 | Deny C1's location permission, then allow it and capture a reading accurate to 100 m or better. | Denial/poor accuracy gives an actionable error; valid location allows session creation.                                               |
| QR-02 | Open a training session, then try opening another before closing it.                            | One open session is enforced; existing session stays usable.                                                                          |
| QR-03 | P1 scans the displayed QR with the phone camera.                                                | Signed-in player checks in; arrival appears in C1's roster and P1's attendance.                                                       |
| QR-04 | Sign P2 out, scan a fresh QR and complete inline PIN sign-in promptly.                          | Token survives the sign-in handoff and leaves the URL; valid scan checks in. If 30 seconds elapse, scanning a fresh code is required. |
| QR-05 | Scan again as an already-recorded player; save an old QR and try it after more than 30 seconds. | No duplicate arrival; expired token is rejected. QR refreshes approximately every 10 seconds, with a 30-second validity window.       |
| QR-06 | In a separate session, manually record P2 and leave P1 unrecorded; close the session.           | P2 is present with a staff-recorded entry; P1 is absent; late check-in is rejected after closure.                                     |
| QR-07 | Inspect session history, overview totals and player attendance after reload.                    | Counts and timestamps agree; records persist and remain scoped to the team.                                                           |

The current GPS gate applies to the coach starting training. Player check-in
submits the signed QR token; it does not collect or validate player GPS. Do not
record player geofencing as a tested or implemented control.

## 7. Device notifications, PWA and media

| ID      | Action                                                                                 | Expected result                                                                                                                                                |
| ------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUSH-01 | C1 opens Account and explicitly enables device notifications.                          | Permission/subscription succeeds; private VAPID material stays on the backend.                                                                                 |
| PUSH-02 | Put C1's app in the background, submit new proof as a player and tap the alert.        | A generic receipt notification arrives; tap opens the correct dues month, including after sign-in if necessary.                                                |
| PUSH-03 | Disable notifications or sign that device out; submit another distinct proof.          | No new notification is delivered to the disabled/revoked subscription. Already delivered OS notifications may remain visible.                                  |
| PUSH-04 | Repeat receipt notification on Android and an installed iPhone PWA.                    | Actual supported devices receive alerts; browser emulation is not evidence of delivery.                                                                        |
| PWA-01  | Install, close and reopen the app; sign in separately as staff/player.                 | Installation icons/name are correct and launch resolves the appropriate workspace.                                                                             |
| PWA-02  | Disconnect the phone and navigate/reload; reconnect and refresh.                       | Generic offline fallback appears without cached private records; writes are not falsely acknowledged; online data recovers.                                    |
| PWA-03  | Review desktop/tablet/phone media, manual pause and reduced-motion setting.            | Hero/auth films behave correctly; management landing section uses training WebP; phone split layouts avoid video downloads; reduced motion retains the poster. |
| PWA-04  | Deploy an actual frontend update with a prior PWA/tab open and follow update guidance. | Updated app becomes usable without broken navigation or private-data caching. Mark NOT RUN until there is a real update.                                       |

## 8. Removal, isolation and operations

Run removal last and coordinate server restarts with the VPS operator.

| ID        | Action                                                                                                           | Expected result                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACCESS-01 | Remove P2 using roster confirmation, then refresh their existing session and attempt correct-PIN sign-in.        | Specific team-removal message appears; player loses access; the removal cannot be undone with Activate.                                           |
| ACCESS-02 | Inspect removed roster view, old attendance/dues and a new later month's dues.                                   | Historical records remain; removed player is hidden by default and receives no new future-month obligations.                                      |
| ACCESS-03 | With C3/P3 in a separate QA team, request another team's session, receipt and management record through the API. | Cross-team data is denied; use only test record identifiers, never those of an unrelated real team.                                               |
| AUDIT-01  | Open `/management/audit`; review bank changes, manual attendance, payment review/reversal and removal.           | Actions appear with actor/time and applicable reason; refresh does not change them.                                                               |
| OPS-01    | Check Account's operations summary and operator's API/worker logs after the test run.                            | No unexplained failed jobs or repeated crashes; email/push delivery is confirmed separately.                                                      |
| OPS-02    | Operator restarts worker, then a QA user requests a new verification/recovery email.                             | Queued delivery recovers without a duplicate account or lost challenge.                                                                           |
| OPS-03    | Operator restarts API while C1 is signed in; reload and access bank details/private proof.                       | Session and encrypted data still work with the unchanged keys.                                                                                    |
| OPS-04    | Operator exports data privately and rehearses restore into a separate database.                                  | Restore succeeds; stable encryption keys are available through the private recovery procedure.                                                    |
| OPS-05    | On dedicated staging data, simulate up to 50 player arrivals, including retries.                                 | No duplicate attendance, connection exhaustion or memory kills; record measured response times. Do not load-test the live team's payment records. |

## Results and issue reporting

| Case ID | Status  | Actual result / issue | Device and time | Evidence reference |
| ------- | ------- | --------------------- | --------------- | ------------------ |
| NET-01  | NOT RUN |                       |                 |                    |
| NET-02  | NOT RUN |                       |                 |                    |
| NET-03  | NOT RUN |                       |                 |                    |

Add one row per tested case. For failures, record the exact page/action, expected
and actual behaviour, error text, timestamp/timezone and request ID if available.
Screenshots should hide private data. An API failure can be correlated with the
operator's logs using its request ID; never paste raw cookies/authorization or
the completed environment file.

Functional checks, real email/push/GPS acceptance and operator recovery checks
need their own evidence. A passing mocked Playwright journey alone does not
prove deployed provider delivery or physical-device behaviour. Keep blocked
checks visible and assign an owner before inviting the real team.
