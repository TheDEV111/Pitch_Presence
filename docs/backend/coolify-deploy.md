# Coolify deployment

Production runs from `docker-compose.yaml` as a Docker Compose application on Coolify. PostgreSQL is hosted on Supabase.

## Architecture

- `api`: runs `scripts/start-api.sh`, which executes `prisma migrate deploy` and then the API server.
- `worker`: runs `apps/api/dist/worker.js`. It never migrates, so there is no migration race.
- `api` and `worker` also join the external `coolify` network so Traefik can route to `api`.
- `DATABASE_URL` is passed through from the Coolify environment. Use the Supabase session-mode pooler (port 5432) with `sslmode=require`; Prisma `migrate deploy` needs session mode or a direct connection.
- Compose passes an explicit list of variables to the containers (`x-app-env`). Nothing else from the Coolify environment reaches the app, and required variables fail fast at render time.

## Environment variables

Set these in the Coolify application environment.

| Variable                                                        | Required | Notes                                                                          |
| --------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                  | yes      | Supabase connection string, with `?sslmode=require`.                           |
| `SESSION_SECRET`, `DATA_ENCRYPTION_SECRET`, `QR_SIGNING_SECRET` | yes      | Independent random strings, 32+ characters each.                               |
| `APP_URL`                                                       | yes      | Public web origin, for example `https://pitchpresence.com`.                    |
| `RESEND_API_KEY`, `EMAIL_FROM`                                  | yes      | Transactional email.                                                           |
| `PAYMENT_MODE`                                                  | no       | Default `MANUAL`.                                                              |
| `PAYSTACK_SECRET_KEY`                                           | no       | Only when Paystack is enabled.                                                 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`        | no       | Web push.                                                                      |
| `TRUST_PROXY`                                                   | no       | Traefik proxy IP or CIDR (the Coolify docker bridge subnet).                   |
| `MULTI_TEAM_ENABLED`                                            | no       | Defaults to `false`; enable after the Account migration and acceptance checks. |
| `LOG_LEVEL`                                                     | no       | Default `info`.                                                                |

### Finding the `TRUST_PROXY` subnet

Without `TRUST_PROXY`, every request appears to come from Traefik, so IP-keyed rate limits (`otp-ip`, `login-ip`, `register`, `invitation-preview`) are shared by all clients. On the Coolify host run:

```bash
docker network inspect coolify -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

Set `TRUST_PROXY` to that CIDR (for example `172.21.0.0/16`). This is safe because the `api` service publishes no host port, so only containers on that network can reach it. If Cloudflare proxying sits in front of Traefik, client IPs will be Cloudflare edges; trust its ranges too.

## Deploy

1. Create a Docker Compose application in Coolify pointing at this repository and branch, compose file `docker-compose.yaml`.
2. Set the variables above.
3. Assign the domain to the `api` service on port 4000.
4. Deploy. Health check: `GET /api/v1/health/ready`.

## Validate locally

```bash
docker compose --env-file <file with the required variables> -f docker-compose.yaml config --quiet
```

CI runs the same check plus an image build, migration and smoke test of both processes.

## Membership migration maintenance window

The API startup script automatically applies pending migrations. The Account migration is included in this release even when `MULTI_TEAM_ENABLED=false`. Before deploying this commit, back up Supabase and rehearse that migration on a restored copy. Stop both API and worker through Coolify, deploy the new API, and let the worker start after API health confirms migration completion. Deploy the compatible frontend and verify existing staff/player flows before enabling `MULTI_TEAM_ENABLED=true`. See [team memberships](team-memberships.md).

Verify the logged client IP using two devices on different internet connections. A larger registration allowance complements correct proxy configuration; it cannot establish whether the deployed forwarding chain identifies each visitor correctly.
