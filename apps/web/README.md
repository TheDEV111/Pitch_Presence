# PitchPresence web

Next.js App Router, React, TypeScript, Tailwind v4 and the shared public backend contracts. The UI follows the root [design specification](../../design.md).

## Run

From the repository root:

```bash
npm ci
npm run build -w @pitchpresence/shared
npm run dev:web
```

The landing page and authentication layouts render without provider credentials or a running API. `http://localhost:3000` is the frontend. For connected journeys, configure the root `.env`, start PostgreSQL, apply migrations, and run `npm run dev` to start the API and web together. Run `npm run worker` separately for email delivery and payment jobs. Next proxies `/api/*` to `http://127.0.0.1:4000` by default; set server-only `API_URL` to change that target. The API's `APP_URL` must match the browser origin, including the port. Production needs HTTPS for cookies and geolocation.

Authentication, registration and payments use the real API. There is no mock authentication or payment success. Coaches/managers self-register at `/signup`, verify email and create a team. Staff use email/password at `/sign-in`; players use email/PIN at `/player/sign-in` and register through a team invitation. Team settings support email-bound staff invites and password/email-confirmed transfer accounts. Players upload private PDF/PNG receipts; staff approve or reject them through dues management. Paystack setup and checkout are paused by the default manual mode.

Interrupted signup resumes email verification after refresh in the same tab. Only the pending email, role and resend deadline are stored in session storage, for at most 24 hours; credentials, OTPs and invitation tokens are never stored. Correct credentials on an unverified account open verification. A verified cookie resumes the server's team/invitation step even when browser hints are lost. Staff signup retries with the original password retain the account and current code; account creation and email queuing commit together. Connection failures during the initial session check offer a retry rather than allowing a stale auth context to submit forms.

## Routes

| Audience   | Routes                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public     | `/`, `/signup`, `/sign-in`, `/player/sign-in`, `/staff/join?invite=…`, `/verify-email`, `/forgot-password`, `/register?invite=…`, `/reset-pin`        |
| Player     | `/home`, `/attendance`, `/dues`, `/dues/payment-return?paymentId=…`, `/check-in#token=…`                                                              |
| Manager    | `/management`, `/management/training`, `/management/training/:id`, `/management/players`, `/management/dues`, `/management/audit`, `/management/team` |
| Onboarding | `/onboarding/team`, `/onboarding/staff-invitation`                                                                                                    |
| Both roles | `/account`                                                                                                                                            |

The backend enforces every role and mutation. HTTP-only session cookies remain inaccessible to JavaScript. The CSRF token lives in memory and authenticated mutations send `X-CSRF-Token`. A QR fragment is removed from the address bar and retained only in memory through inline sign-in. A page reload requires a fresh scan. PINs, OTPs and attendance tokens are never stored. Nonsecret payment attempt keys and amounts are kept in session storage to make retries idempotent.

## Media and fonts

Photo sources, creators, licences, dimensions and focal points are recorded in [the asset register](public/media/manifest.json). Development previews can use Pexels CDN images and Google Fonts. Production uses local media and system fallbacks; it never falls back to third-party image or font hosts. Photos illustrate football training and do not imply customer endorsement.

On a machine with internet access:

```bash
npm run media:sync
NEXT_PUBLIC_LOCAL_MEDIA=true NEXT_PUBLIC_LOCAL_FONTS=true npm run build
```

The script prepares local WebP derivatives at 320, 640, 960, 1440 and 1920px and subsetted Antonio/Inter WOFF2 fonts with OFL licences. Production uses local photography with a neutral fallback and omits external font stylesheets. The film renderer assembles a clean 15-second edit from the original licensed Pexels warm-up and coaching footage. It adds no text, headline bands or diagrams. See the [clean-film recipe](../../docs/frontend/hero-film-brief.md). Phone diagrams and app panels stay in the interactive walkthrough below. The clean 15-second video exports have been imported. Desktop/tablet authentication and onboarding left panels, plus the landing management panel, use the same film with its portrait crop and pause/resume controls. Phone split panels do not download video; reduced motion shows a poster and media failures retain a photograph. Future replacement exports require the registered original masters and current FFmpeg/FFprobe. See [PWA and media release instructions](../../docs/frontend/pwa-media.md) for tools, commands and the dedicated GitHub workflow.

## Verification and limitations

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:web
```

The browser checks cover staff signup/team creation, credential separation, existing staff invite acceptance, and desktop/mobile walkthrough controls, responsive widths, role restrictions, QR expiry, inline check-in sign-in, and pending payment states. They use explicit test API fixtures; they do not certify provider integration. Browser tests are wired into CI. Local browser execution was blocked here by sandbox socket permissions.

Collections offer explicit cursor pagination. Player search covers loaded records and is labelled accordingly. Training history uses backend chronological pagination; `/management/overview` independently supplies the current session, recent history and full-team player/dues counts. Player attendance and audit pages show record order and dates. Setup flags remain visible so optional player, dues and bank tasks can be resumed.

Live session QR codes refresh every 10 seconds; an expired code is hidden immediately. The roster refreshes every 5 seconds while visible and preserves prior data with an error notice on failed refreshes. Manual confirmations, account deactivations, invitation revocations and session closure use native accessible confirmation dialogs. Payment redirects never establish settlement; the return page reads and verifies server status.

Production builds generate a service worker for the independent offline screen and approved static assets. Authenticated HTML, API responses, route data, query-bearing assets and videos are not cached. The manifest starts at `/launch`, which checks the online session and routes to the correct dashboard/onboarding step or offers both sign-in choices. Install guidance is available on role home/account screens. There is no offline write queue; reported-offline mutations are rejected without being sent. Updates wait until old app windows close. Automated cache checks are included; installed-app behaviour and real providers still require deployed device testing.
