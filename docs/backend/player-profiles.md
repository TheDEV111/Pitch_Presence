# Player football profiles

## Ownership and experience

Players edit their photo, preferred foot, primary position, and up to two secondary positions at `/profile`. These preferences belong to the Account and follow its player memberships across teams. Coaches can read their team's profiles and edit only the membership's shirt number and assigned position. Existing per-team display names and historical IDs remain unchanged.

The player card shows football preferences, current-team details, membership state, a text-labeled pitch diagram, and attendance. Roster thumbnails/names open `/management/players/:membershipId`; removed players retain historical roster rows without a live profile link. There is no public sharing, teammate directory, invented rating, or medical data. Missing profile fields never block onboarding, attendance, dues, or login. Initials replace missing/unavailable photos.

Attendance is calculated in one database snapshot from closed sessions where this membership appeared in the session roster: attended = rows with an attendance entry; missed = eligible rows without one. Open sessions and sessions without that player on the roster are excluded. Empty history has no percentage. Other memberships' attendance and team assignments are never combined.

## Interfaces

| Endpoint                                       | Access and behavior                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/v1/me/player-profile`                | Player's shared profile plus selected team's assignments and attendance |
| `PATCH /api/v1/me/player-profile`              | Player edits preferredFoot, primaryPosition, secondaryPositions         |
| `PUT /api/v1/me/player-profile/photo`          | Player uploads `{content: base64, mimeType}`                            |
| `DELETE /api/v1/me/player-profile/photo`       | Player removes their shared photo                                       |
| `GET /api/v1/management/players/:id/profile`   | Selected team's staff read an available player profile                  |
| `PATCH /api/v1/management/players/:id/profile` | Selected team's staff edit shirtNumber and assignedPosition             |
| `GET /api/v1/players/:id/photo`                | Owner or selected team's staff retrieve a private WebP                  |

Player edits submit the complete three football fields; team edits submit both assignment fields. Nullable values clear optional fields. Unknown properties are rejected. Feet are LEFT/RIGHT/BOTH. Position codes and readable labels live in the shared contracts. Secondary positions must be unique, at most two, and different from the primary position. Shirt numbers are optional integers 0–99; duplicates are permitted for training squads.

Roster DTOs include a small `playerProfile` summary; removed memberships return null. Bytes, Account IDs, credential hashes, and other teams' memberships are not included. Profiles/photos for removed memberships return 404. Inactive but non-removed players remain visible to their staff. Normal cookie, role, Origin, CSRF, and stale-workspace checks apply. Photo GET requests use cookies directly, with no public Next image optimizer. The service worker does not cache API requests.

## Private image processing

Input is bounded to 2 MiB, restricted to JPEG/PNG/WebP and 20 megapixels, with server-side decoding, MIME matching, canonical base64 validation, and animation rejection. Sharp applies orientation, removes metadata, center-crops to 512×512, and encodes WebP capped at 256 KiB. Only normalized bytes and an opaque version UUID are stored; the original filename and original bytes are discarded. Failed processing leaves the existing photo intact.

The server permits 10 photo mutations per hour per account, including failed processing and removals, across teams. Replacements and deletions are atomic. Audits record profile field changes or photo change/removal events, never image bytes. Image responses use `private, no-store`, `nosniff`, and restrictive CSP. A revision query updates displayed avatars after replacement; it grants no access.

At the initial scale, 100 maximum-sized avatars require at most 25 MiB of photo bytes. PostgreSQL storage avoids additional service credentials; switch to private object storage if roster volume grows substantially. This is not a public media library.

## Deployment and validation

The additive `20261015010000_player_profiles` migration creates Account-owned PlayerProfile and nullable membership fields; existing users, sessions, and names are preserved. Sharp is an API runtime dependency. Deploy the migration/backend before the frontend and ensure the VPS/proxy accepts the bounded 2.85 MB JSON body. No new environment secrets are needed. The development-only cleanup table list includes the new table; the production migration performs no cleanup.

Run Prisma generation/validation, backend build and tests, type checks, lint, formatting, frontend build, and Playwright. Integration coverage includes role/field restrictions, CSRF/workspace protection, multi-team ownership, attendance eligibility, photo normalization/privacy, removal blocking, upload failure preservation, and account-wide photo throttling. Browser tests cover form recovery, live card/position preview, upload preview/save/removal, coach editing, refresh, and responsive layout. Test in staging with one player in two teams before production release.
