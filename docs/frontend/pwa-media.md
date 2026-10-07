# PWA and release media

## Installation and connection flow

The manifest opens `/launch`. An online session determines the player dashboard,
management dashboard or outstanding onboarding step. Signed-out users choose
staff or player access. Installation guidance is available on role home/account
screens; iOS instructions explain Safari's Share → Add to Home Screen action.

Production builds generate `/sw.js` after Next finishes. It precaches only the
independent offline screen, its stylesheet/script and brand icons. Approved
build-specific JavaScript/CSS can be cached on demand. API calls, mutations,
authenticated HTML, route-data requests, query-bearing assets, media and third-party
requests never enter the worker cache. Offline navigation returns the generic
reconnection screen; HTTP errors retain their server status. There is no offline
account history or write queue. Retry is user initiated; expired attendance
requires scanning the coach's current QR. First-ever visits need a connection.

Updates wait until all old app windows/tabs close. The update notice asks users to
finish their task, close windows and reopen. It never forces a reload or calls
skipWaiting. Only caches prefixed `pitchpresence-static-` are removed on activation.
No user data is stored in those caches. Session handling still uses the server's
HTTP-only cookies. Installed-app/browser session sharing must be tested per device.

## Finish photography, fonts and the film

Requires a network-enabled machine, Node 22, FFmpeg/FFprobe with libx264, Chromium
and Python FontTools with WOFF2 support. No provider API keys or paid video service
are needed. `.media-source` and `.media-work` are ignored; only licensed derivatives,
font licence files and the asset register belong in the repository.

```sh
npm ci
python3 -m pip install 'fonttools[woff]==4.63.0'
npx playwright install chromium
npm run media:icons
npm run media:sync
NEXT_PUBLIC_LOCAL_FONTS=true npm run build
NEXT_PUBLIC_LOCAL_FONTS=true npm run start -w @pitchpresence/web
```

With that preview running, in another terminal:

```sh
npm run media:video
npm run media:verify
```

Video masters download directly from the official MP4 CDN URLs in the asset register,
without scraping Pexels HTML pages. If a CDN download fails, download the licensed files from the
source pages recorded in `apps/web/public/media/manifest.json` into
`.media-source/warmup.mp4` and `.media-source/coaching.mp4`, then retry. Photography
masters can similarly be supplied as `training.jpg` and `coach.jpg`. Sources must
meet the verified dimensions/duration. Existing master checksums protect against
silent source changes; review the licence/source before intentionally updating them.

Alternatively run **Actions → Prepare release media → Run workflow**. Download the
`pitchpresence-release-media` artifact and copy its media/fonts/icons folders into
the corresponding `apps/web/public` folders. Review the footage, crops and overlays,
then commit the derivatives and updated register. The workflow does not publish or
push assets. A blocked stock download fails explicitly rather than substituting
unrelated footage. The local environment could not download masters or execute
Chromium, so media generation and visual acceptance must finish on that runner.

If film rendering fails, the log identifies the last media stage and a safe error
summary. Download the `media-render-failure` artifact for the same stage/message in
`render-failure.json`. It contains no raw browser or FFmpeg logs, source URLs or
credentials. Missing input/font errors require rerunning `media:sync`; Chromium
errors require installing the documented browser dependencies. The workflow stops
before rendering if its preview server exits or fails to become ready. Browser
traces are uploaded only after a failed browser test that actually produced reports.

The film uses the existing fictional demo components captured through Playwright;
all API requests are intercepted and external browser requests blocked. Its four
three-second scenes show warm-up, opened attendance, recorded arrival and monthly
dues. Demo QR artwork is not scannable. Exports are silent H.264/yuv420p at 24fps:
1920×1080 desktop (≤3MB), 720×900 mobile (≤1.5MB), with responsive WebP posters.
Each scene is exactly 72 frames with a shared 24fps MP4 time base; the film is 288
frames. Logs and failure reports include actual bytes, duration and frame counts.
Oversized exports receive a two-pass encode with a bitrate derived from their
size budget, reserving 15% for container overhead and bitrate variation. The size
and timing checks still reject outputs that exceed their limits. The media workflow
runs a synthetic mixed-frame-rate/overlay encoding test before capturing the film.
FFmpeg uses fast-start MP4 delivery. Playback begins only after Play; pause/replay,
visibility handling and text description accompany it. The interactive walkthrough
remains available. `film.json.ready` becomes true only after both exports finish;
unrendered builds show a photograph instead of an empty video player.

Photographs have responsive widths 320/640/960/1440/1920, ≤250KB through 640px and
≤500KB for larger sizes. Antonio/Inter WOFF2 subsets include Latin, punctuation and
currency symbols, retain OFL licences and are each ≤180KB. Production photography
never falls back to an external host; unavailable images show a labelled neutral
surface. Production omits Google Fonts. Set `NEXT_PUBLIC_LOCAL_FONTS=true` to use
the prepared fonts; otherwise the system font fallback remains usable.

## Release checks

```sh
npm run media:verify
REQUIRE_LOCAL_MEDIA=true NEXT_PUBLIC_LOCAL_FONTS=true npm run build
npm run security:check:browser
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:web
```

`REQUIRE_LOCAL_MEDIA=true` fails the web build unless local assets, their recorded
checksums and film readiness pass. The full media verification uses FFprobe;
build-time verification checks already inspected outputs against their hashes.
Ordinary CI can test PWA behaviour before footage is available; it is not media
release acceptance. Chromium emulation does not prove Safari installation.

On HTTPS staging, test real Android Chrome and iPhone/iPad Safari installation,
standalone launch, native-camera QR links, slow connections, offline cold navigation,
payment-return retry, and updating with two app windows open. Confirm caches contain
only public assets. Test an API outage separately from browser-reported offline.
Check mobile text legibility and no video request before Play. No deployed-device
acceptance has been performed by these changes.

## Worker rollback

Deploy a replacement `/sw.js` at the same URL, with no-cache response headers:

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('pitchpresence-static-')) await caches.delete(name);
      }
      await self.registration.unregister();
    })(),
  );
});
```

This emergency worker does not intercept fetches or reload open pages. Keep it
served long enough for returning installations to receive it; restoring the normal
worker later re-enables the offline screen. Do not delete other apps' origin caches.
