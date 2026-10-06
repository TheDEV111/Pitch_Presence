# Architecture decision records

| Decision                                            | Status                      | Rationale and consequence                                                                                                      |
| --------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Modular monolith, separate API/worker processes     | Accepted                    | One deployment codebase with clear domain ownership; no microservice coordination in V1.                                       |
| npm workspaces, shared contracts, Prisma/PostgreSQL | Accepted                    | Keeps backend and future PWA together; migration SQL enforces database invariants.                                             |
| Tenant per team, two roles                          | Accepted by product         | Team IDs scope all operations. Globally unique email; one team per account; coaches/managers share MANAGER permissions.        |
| Same-origin opaque cookie sessions                  | Accepted                    | Supports native camera landing pages and remembered devices without browser-held bearer tokens.                                |
| PostgreSQL durable jobs and rate limits             | Accepted                    | Shared state and recovery across instances without Redis.                                                                      |
| Manual creation, one open session per team          | Accepted by product         | Simplifies management and QR display; DB constraint handles competing starts.                                                  |
| Location <=100m, fresh capture required             | Accepted by product/default | Records session origin; no permission bypass or continuous tracking.                                                           |
| Eligible roster snapshot at opening                 | Accepted                    | Stable historical absence; players joining during training enter the next session.                                             |
| QR lifetime 30s, refresh 10s                        | Accepted by product         | Allows extra time for network delays after scanning; signed expiry limits screenshot reuse, but live sharing remains possible. |
| NGN/kobo, Lagos calendar boundaries                 | Accepted by product         | Integer money and a single team calendar independent of server timezone.                                                       |
| Player-entered amount >= configured minimum         | Accepted by product         | A qualifying payment marks paid; V1 has no accumulation or subscriptions.                                                      |
| Freeze monthly minimum on first financial activity  | Accepted                    | Prevents pending checkout and manual-confirmation terms from changing.                                                         |
| Prior unpaid months remain settleable               | Accepted by product         | Month rollover preserves records without making unpaid history immutable.                                                      |
| Manual external reversals with reason               | Accepted by product         | Preserves evidence and recomputes status; Paystack refunds are excluded.                                                       |
| Embedded PostgreSQL test fallback                   | Accepted for local tooling  | Runs SQL without network sockets; real PostgreSQL CI proves independent-connection locking.                                    |

Dependency versions are pinned in the manifests and lockfile. The restricted build environment supplied Fastify 4.29.1 and Prisma 6.19.3 from its package cache. Framework-major upgrades should be performed with plugin compatibility checks and the same regression suite; no migration to a different framework is required by these decisions.

## Staff onboarding and team payments

Public staff signup uses email/password (15–128 characters, Argon2id), six-digit email verification and a team-name-only setup. Players retain invitation-based email/PIN access. Verification creates a device session; the auth context returns team and the resumable next step. Staff invitations are email-bound, single-use and valid for seven days. No staff transfers, promotions, team switching or deletion are exposed.

Team bank connections use immutable Paystack subaccounts and fresh password confirmation. Resolve and explicitly confirm account details before connecting; resolution does not establish ownership. Provider-active destinations enable checkout without assuming Paystack's separate verification status guarantees ownership. Platform commission is zero; the team bears provider fees. Pending checkouts keep the original subaccount when the team changes banks. Unknown creation outcomes require reconciliation without another creation POST. No platform-account fallback exists.

The pre-launch tenant migration assumes disposable development records. Reset is an explicit guarded command, never an application startup action. Production data needs a separate reviewed backfill migration.
