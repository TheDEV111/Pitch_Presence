# Vercel frontend deployment

Deploy the frontend as the Vercel project `pitch_presence`. The API and worker
run on the VPS; PostgreSQL remains on Supabase. This guide does not imply a
project or deployment has already been created.

## Repository and build settings

The GitHub repository is `https://github.com/TheDEV111/Pitch_Presence`.
Vercel's project root must be `apps/web`, with source files outside the root
enabled for workspace packages and PWA/media scripts.

`apps/web/vercel.json` installs dependencies at the monorepo root, builds the
shared package before Next.js, and enables verified local media and fonts.
`deploy/vercel/project-settings.json` supplies the project root and Node 22.

The Install Command runs
`npm ci --workspaces --include-workspace-root --include=dev`. npm resolves the
workspace root and its committed lockfile whether installation starts at the
repository root or `apps/web`. Including the root and development dependencies
provides the shared package's TypeScript compiler and the frontend build tools.
The Build Command still starts from the project's `apps/web` directory.

The install wrapper in `vercel.json` captures npm's output in a temporary file.
On success it prints the full install log; on failure it prints the first 60
lines and preserves a failing exit status. This keeps the actual npm error at
the end of Vercel's build output instead of its lengthy usage help.

`.vercelignore` excludes local environment files, Git metadata, credential
directories and generated build outputs from CLI uploads. `.vercel/` is also
ignored by Git. Never put backend secrets in Vercel environment variables.

## Initial deployment from a network-enabled terminal

Run these commands from the repository root. The commands use the CLI's stored
login; no token needs to be pasted into the shell or repository.

```bash
git remote set-url origin https://github.com/TheDEV111/Pitch_Presence.git
gh auth setup-git
vercel whoami
vercel project add pitch_presence
vercel link --yes --project pitch_presence
vercel api /v9/projects/pitch_presence --method PATCH --input deploy/vercel/project-settings.json
vercel git connect https://github.com/TheDEV111/Pitch_Presence.git
vercel deploy --prod
```

If the project already exists, skip `vercel project add`. Select the intended
Vercel account/team; use the same `--scope` on commands if a specific team is
required. If `vercel whoami` reports an expired login, run `vercel login`.

GitHub integration may require the account owner to install or authorize the
Vercel GitHub App for this repository. Follow the authorization link supplied
by the CLI, then retry `vercel git connect`. Commit and push the deployment
configuration so subsequent GitHub builds use the same settings. A production
CLI deployment can include local changes, but future Git deployments use only
the pushed source.

Check the final output for the assigned production URL; do not assume its
hostname from the project name. Open the landing page and confirm the local
film, fonts, manifest and icons load. Record the exact frontend origin as
`APP_URL` in the VPS environment. Login and other API features require the
backend connection described below.

## Connect the VPS backend

Once the API's public HTTPS origin is ready, set `API_URL` in this Vercel
project's production environment. Supply the origin only, with no `/api`
suffix, credentials or trailing slash. This is a server/build variable, not a
`NEXT_PUBLIC_*` variable.

```bash
vercel env add API_URL production
vercel deploy --prod
```

Enter the actual backend HTTPS origin when prompted. Redeployment is necessary
because Next.js reads the API rewrite destination during the build. Until this
variable is configured, the existing development fallback cannot reach the
VPS from Vercel.

The frontend and backend must agree on the exact frontend origin. Use a stable
production domain for onboarding; preview domains need a separately configured
backend origin or staging environment.

Verify `/api/v1/health/ready` through the frontend, then test real sign-in,
email delivery, receipts, attendance and installed PWA notifications using the
[VPS acceptance checklist](../backend/vps-handoff.md).

## Recover an install failure

In Vercel's project settings, confirm Root Directory is `apps/web` and enable
Include source files outside the Root Directory. The workspace packages,
`package-lock.json`, root build tools and media scripts all require those files.
Remove any stale Install Command override, or replace it with the exact
`installCommand` from `apps/web/vercel.json`, including its logging wrapper.
Push the updated configuration before retrying the GitHub deployment.

The tail of npm's usage text does not identify the failure. Read the first
`npm error code` and the lines following it. If npm reports a missing lockfile,
check the root directory and included source files. If it reports that the
lockfile is out of sync, run `npm install` from the repository root in a
network-enabled terminal, review the resulting lockfile change and commit it.
Keep `npm ci` for reproducible deployments.

Reference: [Vercel CLI Git connection](https://vercel.com/docs/cli/git),
[monorepo setup](https://vercel.com/docs/monorepos), and
[authenticated CLI API requests](https://vercel.com/docs/cli/api).
