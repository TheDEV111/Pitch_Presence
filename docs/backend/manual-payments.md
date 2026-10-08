# Manual payments and transfer accounts

Staff can opt in to [device receipt alerts](receipt-notifications-roster.md).
Notifications never change payment status; staff approval remains required.

Manual payments are the default while Paystack setup is paused. Set
`PAYMENT_MODE=MANUAL` on the API and worker. Paystack credentials are optional in
this mode; checkout, bank resolution and subaccount setup are disabled. Existing
Paystack payment verification/webhooks remain available for reconciling earlier
transactions when their credentials are present.

## Player and staff flow

1. Staff configure the monthly minimum in naira; the backend stores integer kobo.
2. A coach or manager supplies the team bank name, account holder name and
   ten-digit account number in team settings. Ownership is checked by the team;
   no provider account-name verification is claimed.
3. The staff member re-enters their password and receives an email code. The
   account becomes active only after confirmation. Players can then read the
   full transfer details through their authenticated dues screen.
4. A player makes the transfer externally, selects their month, enters the amount
   and optional reference, then uploads a PDF or PNG receipt up to 2 MB.
5. The player and management see **Proof submitted**. The ledger remains unpaid
   until staff inspect the receipt and confirm receipt of funds in the bank.
6. Approval changes the existing pending external payment to SUCCESS and updates
   the month to PAID in one transaction. Rejection requires a reason, leaves the
   month unpaid and lets the player submit corrected proof.
7. Staff can still confirm cash or another external payment directly. When proof
   is pending they review it first, avoiding duplicate confirmations. Approved
   external payments support the existing audited reversal flow.

Proof is a payment indicator, not independent evidence of bank settlement.
Approving an already-approved receipt is a safe retry; it never recreates a
payment or undoes an earlier reversal.

## Bank change controls

All additions, replacements and removals require current-password verification
and a separate six-digit email code. The code expires in ten minutes, allows five
wrong attempts, is bound to the immutable proposal, team and requesting staff
account, and cannot be confirmed by another coach. Passwords and codes are never
stored in browser storage. Code hashes are keyed; queued codes are encrypted and
cleared from job payloads after delivery or final failure.

A new request consumes the previous team's pending proposal. The API serializes
changes with a team row lock and compares the original account version when
applying a proposal. Request limits are three per staff member per hour and five
per team per day. Wrong-password attempts also count towards the request limits.
Confirmation retries after a lost response do not create another account version.

The previous account remains active until confirmation. Removing it disables new
transfer guidance; historical accounts, receipt snapshots and payments remain.
Proof for an already-made transfer can still reference a previous account from
that same team. The upload form lists the 20 latest account versions with masked
numbers so players can identify an already-paid destination without encouraging
a new transfer to a removed account. Older destinations can be resolved by staff
through direct confirmation. All active verified coaches/managers receive an email notification
once a change is confirmed. The worker must run for codes and notices to arrive.
The pending confirmation is recovered from the server after refresh.

Account numbers are encrypted with `DATA_ENCRYPTION_SECRET`, a separate stable
server-only key of at least 32 characters required in production. Development and
tests fall back to `SESSION_SECRET` if it is omitted. Keep the configured data key
with restricted backups; changing it without re-encrypting account versions makes
them unreadable. Authentication-secret rotation does not require bank-key rotation.

## Private receipt storage and limits

Files are stored in PostgreSQL bytea, outside the public frontend folder, so a
sleeping/replaced application host cannot lose uploads. This requires no new
storage-provider credentials. Database size and backups include receipt bytes.
Monitor managed database capacity before expanding beyond the pilot team size.

- Check extension, declared type, canonical base64 and decoded size. Validate PNG
  structure, chunk checksums and bounded decompression; allow non-interlaced PNG
  up to eight megapixels. PDFs require a recognized header and EOF marker.
- These checks do not provide malware scanning or fully parse PDF objects. Treat
  uploaded documents as untrusted: no embedded document viewer or public URL.
- Serve downloads as attachments with an octet-stream type, no-store, nosniff and
  a sandbox CSP. Only the submitting player or staff in the same team can fetch
  a receipt. List responses contain metadata, never file bytes.
- Allow one pending receipt per player/month and at most three submissions per
  month, with five upload attempts per player/hour. A matching file retry returns
  its existing submission. A SHA-256 match elsewhere in the same team is rejected.
- Cap retained receipt bytes at 12 MB per player and 100 MB per team, serialized
  across uploads. When full, staff can record a verified payment directly.
- Remove reviewed receipt bytes 180 days after review through worker maintenance.
  Preserve payment/receipt metadata and audit history. Pending proofs stay until
  review; receipt files are excluded from public PWA caches.

These boundaries follow [OWASP file-upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
and [transaction authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html).

## API additions

All paths are under `/api/v1`; authenticated writes require the allowed origin and
CSRF token.

| Method and path                             | Access                   | Behaviour                                                                                                              |
| ------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `POST /management/transfer-account/request` | Staff                    | `{action:"SET",bankName,accountName,accountNumber,password}` or `{action:"REMOVE",password}`; queue the code.          |
| `POST /management/transfer-account/confirm` | Requesting staff         | `{changeId,otp}`; apply the immutable proposal and queue staff notices.                                                |
| `GET /me/transfer-account`                  | Player                   | Current team transfer account, or null.                                                                                |
| `POST /me/dues/:id/receipt`                 | Owning player            | `{amount,accountId,fileName,mimeType,content,reference?}`; content is base64, with a route-specific bounded JSON body. |
| `GET /receipts/:id/file`                    | Owning player/team staff | Private attachment download; 410 after retained bytes expire.                                                          |
| `POST /management/receipts/:id/review`      | Team staff               | `{decision:"APPROVE"}` or `{decision:"REJECT",reason}`.                                                                |

`GET /me/dues` now includes payment mode, current transfer account, proof
availability and receipt metadata per payment. Staff dues lists include receipt
metadata for review. Team settings include the current account and pending change.
The public OpenAPI file documents the exact request and response schemas.

## Password policy

New staff signup and password reset require 8–128 characters containing an ASCII
uppercase letter, lowercase letter, digit and non-whitespace symbol. The UI and
backend use the same regex. Sign-in and bank reauthentication continue to accept
existing passwords; the new creation policy does not lock out existing accounts.
Player four-digit PINs are unchanged.

## Applying and testing

Generate the client and deploy the additive migration; do not reset the database:

```sh
npm run db:generate
npm run db:deploy
```

Set `PAYMENT_MODE=MANUAL` and a stable `DATA_ENCRYPTION_SECRET`, then restart the API,
worker and frontend. The ignored local `.env` has these configured. No remote
migration is implied by a passing isolated integration test.

Test a real bank addition/code, interrupted confirmation/reload, replacement and
removal. Confirm a player can submit both formats, view pending status and see
approval/rejection in the same month. Check another team cannot download or review
proof. CI executes isolated backend tests and desktop/mobile browser journeys;
real email, real file downloads and concurrent production PostgreSQL behaviour
still need deployment acceptance.

Local validation passed 134 tests, type checking, lint and the guarded frontend build. Six environment-dependent cases remain skipped locally (five multi-connection PostgreSQL tests and one FFmpeg test). Eight new browser cases were discovered but execution could not start because this session cannot bind the preview server. Applying the Supabase migration was attempted and blocked by `P1001` (database unreachable); run `npm run db:deploy` from a network-enabled terminal before testing against it.
