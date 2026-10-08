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

Rendering requires a network-enabled machine, Node 22, FFmpeg/FFprobe with libx264
and Python FontTools with WOFF2 support. Chromium is required for browser tests.
The film uses the same licensed warm-up and coaching masters as the original
GitHub export. No AI provider or API key is required. See the
[clean-film recipe](hero-film-brief.md) for its sequence and source details.
`.media-source` and `.media-work` are ignored; only licensed derivatives,
font licence files and the asset register belong in the repository.

```sh
npm ci
python3 -m pip install 'fonttools[woff]==4.63.0'
npm run media:icons
npm run media:sync
npm run media:video
npm run media:verify
npm run build -w @pitchpresence/shared
REQUIRE_LOCAL_MEDIA=true NEXT_PUBLIC_LOCAL_FONTS=true npm run build -w @pitchpresence/web
```

The film renderer does not need a running app or browser capture.

The renderer downloads the original Pexels video masters from the recorded MP4
CDN URLs in `apps/web/public/media/manifest.json`. It no longer requires an
`arrival.mp4` file, AI generation, caption fonts or product-screen screenshots.
If automated source access fails, download the registered source clips into
`.media-source/warmup.mp4` and `.media-source/coaching.mp4`, then retry.
Photography masters can similarly be supplied as `training.jpg` and `coach.jpg`.
Existing checksums protect against silent source changes.

To regenerate through GitHub:

1. Push the updated scripts and workflow to the repository.
2. Open **Actions → Prepare release media → Run workflow**.
3. Download `pitchpresence-release-media` from the successful run.
4. Extract the artifact outside the public folder, then copy its media/fonts/icons
   folders into the corresponding `apps/web/public` folders, replacing old files.
5. Review both MP4s and posters, then commit the derivatives and updated register.

Do not put the artifact ZIP in the public folder. The workflow does not publish or
push assets. A blocked stock download fails explicitly. Source download is blocked
in this session, so replacement video generation must finish on a machine or
runner with access to the masters and current FFmpeg/FFprobe.

If film rendering fails, the log identifies the last media stage and a safe error
summary. Download the `media-render-failure` artifact for the same stage/message in
`render-failure.json`. It contains no raw browser or FFmpeg logs, source URLs or
credentials. Missing video footage requires supplying the registered warm-up and coaching masters. Missing photography
or font files require rerunning `media:sync`. Chromium
errors in the browser tests require installing the documented browser dependencies. Browser
traces are uploaded only after a failed browser test that actually produced reports.

The film is a 15-second edit of the original real football footage. Five
three-second segments show warm-up and coaching without any overlaid text,
headline bands, phone diagrams, app panels or QR images. The product diagrams stay
in the interactive walkthrough below. It uses distinct sections of the original
masters rather than the proposed AI ball-to-team shot.
Exports are silent H.264/yuv420p at 24fps: 1920×1080 desktop (≤3MB), 720×900 mobile
(≤1.5MB), with responsive WebP posters. The film is exactly 360 frames with a
24fps MP4 time base.
Logs and failure reports include actual bytes, duration and frame counts.
Oversized exports receive a two-pass encode with a bitrate derived from their
size budget, reserving 15% for container overhead and bitrate variation. The size
and timing checks still reject outputs that exceed their limits. The media workflow
runs a synthetic mixed-frame-rate encoding test before rendering the film.
FFmpeg uses fast-start MP4 delivery. The film autoplays silently when at least 25%
of its frame is visible and restarts when it re-enters after scrolling away. It plays
once per entry, pauses offscreen or in a hidden tab, and provides a small pause/resume
icon. Explicit pauses persist across scroll re-entry. Reduced-motion preferences
keep a static poster and prevent automatic video requests. Autoplay policy rejection
retains the poster and permits explicit resume. A text description sits below the
video. The interactive walkthrough
remains available. `film.json.ready` becomes true only after both exports finish;
unrendered builds show a photograph instead of an empty video player.
The previous MP4s contain baked-in phone overlays. Readiness is cleared until the
clean football exports are generated and imported from the new workflow artifact.

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
Check mobile text legibility, autoplay/scroll re-entry, persistent manual pause,
and no automatic video request with reduced motion. No deployed-device
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
