# Coolify deployment

Production runs from `docker-compose.prod.yml` as a Docker Compose application on Coolify.

## Architecture

- `database`: PostgreSQL 16 on the default internal network only. No host ports.
- `api`: runs `scripts/start-api.sh`, which executes `prisma migrate deploy` and then the API server.
- `worker`: runs `apps/api/dist/worker.js`. It never migrates, so there is no migration race.
- `api` and `worker` also join the external `coolify` network so Traefik can route to `api`.
- `DATABASE_URL` is assembled in the compose file from `DB_USER`, `DB_PASSWORD` and `DB_NAME`.
- Compose passes an explicit list of variables to the containers (`x-app-env`). Nothing else from the Coolify environment reaches the app, and required variables fail fast at render time.

## Environment variables

Set these in the Coolify application environment.

| Variable | Required | Notes |
| --- | --- | --- |
| `DB_PASSWORD` | yes in production | Defaults to `pitchpresence`, so always override. |
| `DB_USER`, `DB_NAME` | no | Default `pitchpresence`. |
| `SESSION_SECRET`, `DATA_ENCRYPTION_SECRET`, `QR_SIGNING_SECRET` | yes | Independent random strings, 32+ characters each. |
| `APP_URL` | yes | Public web origin, for example `https://pitchpresence.com`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | yes | Transactional email. |
| `PAYMENT_MODE` | no | Default `MANUAL`. |
| `PAYSTACK_SECRET_KEY` | no | Only when Paystack is enabled. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no | Web push. |
| `TRUST_PROXY` | no | Traefik proxy IP or CIDR (the Coolify docker bridge subnet). |
| `LOG_LEVEL` | no | Default `info`. |

## Deploy

1. Create a Docker Compose application in Coolify pointing at this repository and branch, compose file `docker-compose.prod.yml`.
2. Set the variables above.
3. Assign the domain to the `api` service on port 4000.
4. Deploy. Health check: `GET /api/v1/health/ready`.

## Validate locally

```bash
docker compose --env-file <file with the required variables> -f docker-compose.prod.yml config --quiet
```

CI runs the same check plus an image build, migration and smoke test of both processes.
