# Environment configuration

Copy `.env.example` into `.env` for local use. The root development, worker and explicit development reset commands load this file with Node's `--env-file`. Compiled production entry points read process environment directly.

| Variable            | Requirement                  | Purpose                                                                           |
| ------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| NODE_ENV            | development/test/production  | Cookie security and production validation.                                        |
| PORT                | Default 4000                 | HTTP listen port.                                                                 |
| APP_URL             | Required URL                 | Public browser origin, invitation and callback URLs. Production requires HTTPS.   |
| DATABASE_URL        | Required                     | PostgreSQL connection string.                                                     |
| SESSION_SECRET      | Required, >=32 characters    | Keyed OTP digests, CSRF tokens and encrypted email jobs.                          |
| QR_SIGNING_SECRET   | Required, >=32 characters    | QR signature key; must differ from SESSION_SECRET.                                |
| RESEND_API_KEY      | Required in production       | Worker email delivery.                                                            |
| EMAIL_FROM          | Required sending identity    | Must be permitted by the Resend account.                                          |
| PAYSTACK_SECRET_KEY | Required in production       | Initialization, verification and webhook signature checks.                        |
| LOG_LEVEL           | debug/info/warn/error/silent | Structured HTTP logging.                                                          |
| TRUST_PROXY         | Empty by default             | Comma-separated trusted proxy IP addresses/CIDRs; unrestricted trust is rejected. |
| TEST_DATABASE_URL   | Tests only                   | Dedicated real PostgreSQL database for multi-connection tests.                    |

Generate separate random secrets with `openssl rand -hex 32`. Do not use example placeholder secrets. Keep all credentials server-side; the server-initiated redirect flow does not require a browser Paystack key or separate webhook secret.

Use separate provider test/live credentials and separate databases for staging and production. Configure Paystack's webhook URL as `https://<public-origin>/api/v1/payments/paystack/webhook`. Resend delivery requires the worker and a valid sender identity.

Rotating QR_SIGNING_SECRET immediately invalidates displayed QR tokens. Rotating SESSION_SECRET invalidates pending OTP digests and session CSRF derivations, and makes existing encrypted email jobs unreadable; expire challenges and discard/resend outstanding email jobs during that rotation. Existing opaque device hashes remain valid, and clients can obtain new CSRF values through `/auth/me`.

Staff bank setup, account resolution and checkout use the platform PAYSTACK_SECRET_KEY on the server. Managers supply bank details through authenticated settings, not secret API keys. Resend handles both verification/recovery codes and email-bound staff invitations. No additional frontend provider credentials are needed.
