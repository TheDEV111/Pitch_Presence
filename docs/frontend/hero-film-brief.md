# PitchPresence — clean football film

## Current direction

Return to the real warm-up and coaching footage used in the original GitHub
video. Remove all overlaid captions, headline bands, phone mockups, app panels,
QR graphics and footer branding. Keep the latest requested **15-second duration**.
The proposed AI ball-to-team reveal is no longer the active rendering recipe.

The separate interactive walkthrough below the hero remains available. Muted
autoplay, replay on scroll re-entry, persistent manual pause and reduced-motion
poster behaviour remain in place.

## Footage sequence

The renderer uses five three-second segments from the same two registered sources:

| Film time | Source   | Source segment |
| --------- | -------- | -------------- |
| 0–3s      | Warm-up  | 0–3s           |
| 3–6s      | Coaching | 0–3s           |
| 6–9s      | Warm-up  | 3–6s           |
| 9–12s     | Coaching | 3–6s           |
| 12–15s    | Coaching | 6–9s           |

Offsets are relative to each registered `trimStart` (currently zero). The source
checksum, creator and Pexels licence are recorded in
`apps/web/public/media/manifest.json`. No generated arrival master or AI account
is needed. The renderer applies only crop, scale and timing normalization to each
clip before joining them; it does not composite text or additional images.

## Regenerate the videos

The text and phone diagram are baked into the previously downloaded MP4s. Removing
React elements cannot remove those pixels. Rebuild from the original clean masters.

On a machine with Node 22, current FFmpeg/FFprobe and libx264:

```sh
npm run media:video
npm run media:verify
REQUIRE_LOCAL_MEDIA=true NEXT_PUBLIC_LOCAL_FONTS=true npm run build -w @pitchpresence/web
npm run test:web -- apps/web/e2e/pwa.spec.ts
```

The source loader downloads the registered Pexels MP4s. If download is blocked,
supply `.media-source/warmup.mp4` and `.media-source/coaching.mp4` manually; they
must match the recorded checksums. These ignored masters do not belong in commits.

Alternatively push the changes and run **Actions → Prepare release media**.
Download its successful `pitchpresence-release-media` artifact, extract it outside
`public`, and replace the media/fonts/icons folders under `apps/web/public`.
The workflow installs the tools, downloads the masters, renders both variants,
verifies exports and runs the PWA browser checks. It does not push the files back
to the repository. See [PWA and media release instructions](pwa-media.md).

## Export acceptance and current status

Exports must be **15 seconds / 360 frames / 24 fps**, silent H.264/yuv420p with
fast-start delivery: 1920×1080 desktop ≤3 MB and 720×900 mobile ≤1.5 MB. The size
budget receives two-pass compression if needed. Posters come from the newly
rendered film, so they also contain no overlays.

Review both crops, complete duration, image quality, playback and absence of
text and diagrams. Numeric export checks do not replace picture review.

The clean workflow artifact has been imported and `film.json.ready` is true. Both
exports pass recorded checksums, budgets and metadata acceptance. A local decoder
confirmed 360 frames and a 15-second duration in each file. The ZIP is archived
outside the public directory. Desktop and tablet authentication/onboarding split
panels and the landing management panel now use the same film with its portrait
derivative. Phone split layouts retain their previous form/photo presentation and
do not request the video. Reduced motion displays a poster. Browser and real-device
playback still require the browser checks and staging review.
