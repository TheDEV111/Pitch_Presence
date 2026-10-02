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

Authentication, registration and payments use the real API. There is no mock authentication or payment success. Coaches/managers self-register at `/signup`, verify email and create a team. Staff use email/password at `/sign-in`; players use email/PIN at `/player/sign-in` and register through a team invitation. Team settings support email-bound staff invites and bank account connection.

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

Photo sources, creators, licences, dimensions and focal points are recorded in [the asset register](public/media/manifest.json). This environment cannot download assets over the network. The preview therefore uses responsive Pexels CDN images and Google Fonts, with local media support and readable system font fallbacks. Photos illustrate football training and do not imply customer endorsement.

On a machine with internet access:

```bash
npm run media:sync
NEXT_PUBLIC_LOCAL_MEDIA=true NEXT_PUBLIC_LOCAL_FONTS=true npm run build
```

The script downloads WebP derivatives at 320, 640, 960, 1440 and 1920px and self-hosted Antonio/Inter fonts with OFL licences. Review photo crops and byte sizes before deployment; target 250KB mobile / 500KB desktop for the hero. If the full font files need further size reduction, subset to the product's supported characters with a font tooling pipeline. No video asset is shipped. The landing story uses an accessible component animation with user-controlled playback, static chapters, reduced-motion support and an inert QR illustration. The optional training clip can be added once sourced.

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

The manifest supplies install metadata. No service worker or offline mutation queue is included: authenticated responses are fetched with `no-store`. Full PWA install/offline shell support remains a later step requiring safe cache rules. Browser validation and real-provider verification must be completed in a networked environment before release.
