# Accounts and team memberships

## Behaviour

One normalized email identifies an `Account`. That account may have one membership in each team, with a different role in each team. A person can be staff in ALX and a player in another team. Joining requires a valid invitation and authentication to the existing account. A player invitation cannot grant staff access; staff invitations remain email-bound.

`MULTI_TEAM_ENABLED` defaults to `false`. Set it to `true` in the private backend environment only after the migration, compatible API/worker/frontend deployment and acceptance checks. The flag controls new cross-team invitations/memberships; turning it off does not delete memberships or disable switching between already-created memberships.

Existing single-team users continue opening their original workspace. Users with multiple memberships get a **Switch team** menu showing the team and role. PIN sessions can use player workspaces; a password is required before opening or joining a staff workspace. A player without a password can establish one using the email password-recovery flow, then reopen the staff invitation. A coach without a player PIN chooses one when accepting the first player membership. Passwords and PINs belong to the account, not individual teams.

Removing/deactivating a player affects that team's membership and its sessions only. Other memberships and all historical records remain intact. Removed memberships cannot be rejoined through a fresh invitation. An account with no usable membership retains its historical identity but needs support/team access resolution before it can join through an authenticated invitation.

## Storage and compatibility

`User` is retained as the database name for a **team membership**, avoiding a rewrite of historical foreign keys. Its ID, team, role, activation/removal status and team-specific display name are membership properties. `Account` owns unique email, verification and canonical credential hashes. The repeated email and role-specific hashes on `User` are compatibility fields. The database trigger binds new records to an identity and prevents identity reassignment. Credential reset updates all relevant compatibility hashes.

Migration `20261012000000_accounts` runs transactionally. It creates one account per existing user and sets `accountId` to that user's existing ID. It keeps all old `User` IDs and historical tables unchanged, replaces the unique membership-email index with identity-email uniqueness, and adds uniqueness for `(accountId, teamId)` plus one pre-team membership per account. Existing staff sessions are labelled `PASSWORD`; existing player sessions are labelled `PIN`.

Attendance, monthly dues, receipts, payments, team creators, bank changes, audit actors and worker payloads continue referencing membership IDs. Because each additional team has a separate membership ID, a person's dues for the same month cannot collide between teams. Backend authorization and workers use the selected membership's team and role, never an arbitrary client-supplied team ID.

## Sessions and API

Authentication responses keep their existing fields and add:

- `memberships`: own membership IDs, team IDs/names, roles and active/removal status.
- `authMethod`: `PIN` or `PASSWORD`.
- `hasPlayerPin`: whether the account has established player credentials.

`POST /api/v1/auth/invitations/accept` accepts `{ token, pin?, password? }`. It validates invitation kind, expiry, revocation and staff email binding, adds or resumes the appropriate membership, and returns a new authentication context/cookie. A valid invitation retry for an already-active matching membership returns the existing membership. Signup with an existing email returns `ACCOUNT_EXISTS` and never replaces its credentials or joins another team without authentication.

`POST /api/v1/auth/memberships/switch` accepts `{ membershipId, password? }`. The membership must belong to the current account. Switching to staff from a PIN session requires a valid password. Successful switching issues a fresh session and CSRF token, revokes the previous session and removes its push subscription. Receipt notifications require fresh consent for the selected team.

The existing `/auth/staff-invitation/accept` remains staff-only for onboarding compatibility. Device listing/revocation covers the account's sessions across memberships. PIN/password reset revokes all account sessions and push subscriptions. Ordinary logout revokes the current session only.

The browser sends `X-Membership-Id` after loading authentication context. A protected request whose cookie selects a different membership returns `409 WORKSPACE_CHANGED`, before executing its handler. Old tabs show a reload screen; no automatic retry of mutations occurs. CSRF still protects writes independently. The initial authentication lookup does not assert a previously selected team.

## Production rollout

1. Take a complete PostgreSQL backup and verify that it can be restored to an isolated database. Record counts for User, attendance, dues, payments, receipts and audit events.
2. Rehearse the migration against that copy. Compare IDs, credential hashes, statuses, financial references and table counts. Automated migration tests cover seeded history, but are not a substitute for checking the real backup.
3. Build the compatible backend image, keeping `MULTI_TEAM_ENABLED=false` in the Coolify environment. Schedule a short maintenance window and stop both API and worker in Coolify before deploying the new API. Its `scripts/start-api.sh` automatically runs `prisma migrate deploy` before starting the server. The worker starts only after API health confirms migration completion.
4. Confirm the migration succeeded in API startup logs and both new processes are healthy. Verify an existing staff password, player PIN, verification recovery, receipt flow and training history.
5. Deploy the compatible frontend. Close/reload old client tabs for the pilot. Confirm that existing single-team users do not see a team switcher.
6. Enable `MULTI_TEAM_ENABLED=true` and restart the API. Pilot one staff/player dual membership; verify password step-up, team isolation, same-month dues, scoped removal and notifications.

No production migration or account cleanup is performed by the implementation session. Do not run the test-data cleanup command during this rollout.

If a fault appears, disable additional joins and use a compatible forward fix. Do not drop Account, remove membership rows, or restore an old backup over new writes. An old backend binary is not a supported rollback once multiple memberships exist. A pre-migration restore is only appropriate during the maintenance window before new application writes, under the operator's recovery procedure.

## Validation

Run `npm run db:generate`, `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build`. Run `npm run test:web` after a production frontend build in an environment that permits the local preview server.

Integration coverage includes dual-role membership, existing-account conflicts, authenticated invitation retries, PIN privilege isolation, password recovery before staff acceptance, cross-account switching denial, scoped removal, stale-tab protection and a pre-existing-data migration. Embedded PostgreSQL verifies SQL and transactions; the real multi-connection concurrency suite requires an isolated `TEST_DATABASE_URL`.

## Authorized ALX test-team cleanup

The disposable ALX team ID is `8424095d-9e32-4445-83bd-7b2bc5497292`. This authorization does not cover any other team.

Use `npm run db:delete:alx:test` for a read-only preview. After stopping API/worker writes, run:

```bash
npm run db:delete:alx:test -- --confirm-alx-test-data-loss
```

The command supports `--ssl-root-cert=/path/to/supabase-ca.crt` with certificate verification enabled. If a terminal cannot connect, the database owner can run the complete contents of `scripts/delete-alx-test-team.sql` in Supabase SQL Editor. The script is fixed to this ID, checks that its name identifies ALX, and returns `target_team_absent=true` when complete. It works before or after the Account migration.

The transaction deletes ALX memberships, pending staff applicants tied only to its invitations, attendance, dues, payments, receipts, bank records, invitations, sessions, subscriptions, jobs and associated audits. Account identities with other memberships are retained; identities used only by ALX are removed so disposable emails can register afresh. Other teams' records and shared account credentials remain unchanged. Existing global rate-limit counters expire normally and are not cleared.

Cleanup takes table locks and briefly disables only the append-only audit trigger to remove authorized test audits, restoring it before commit. Foreign-key constraints remain enabled throughout. A temporary inactive creator resolves the team/creator reference cycle and is removed inside the same transaction. Unexpected references cause a complete rollback. The script needs database-owner privileges and is repeatable if ALX is already absent. It performs no migration and must never be replaced with the all-teams test cleanup.
