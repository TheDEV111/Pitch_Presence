# Invitation refresh recovery

## Cause

Invitation URLs are removed from browser history after capture, and the raw token is held only in component memory. Previously, refreshing before registration discarded the token, leaving `/register` without invitation context. The UI then incorrectly asked the player to obtain a new invitation even when the original was still valid. Email verification had its own recovery hint, so post-registration OTP refresh is a separate flow.

## Continuation protocol

Successful `GET /api/v1/invitations/preview?token=...` responses now include `contextId` and `contextExpiresAt`. The API stores the invitation token inside an AES-GCM-encrypted, HttpOnly, SameSite=Lax cookie scoped to `/api/v1`. Production uses Secure cookies with the `__Secure-` prefix. Encryption uses the existing data-encryption secret with a distinct purpose namespace. Tokens are not returned in preview/resume JSON.

The cookie is valid for at most 30 minutes, bounded by invitation expiry. At most five invitation continuations are retained per browser to support several tabs without unbounded cookie growth; oldest or invalid contexts are cleared when issuing another. Cookies grant no login session and cannot override role, email binding, expiry, revocation, or membership checks.

The current tab stores only `{id, expiresAt}` under `pitchpresence:join:PLAYER` or `pitchpresence:join:MANAGER`. After refresh, `GET /api/v1/invitations/resume?context=<id>` uses that opaque ID plus its protected cookie to revalidate the original invitation and restore the team form. Copying the reference without the cookie, tampering with a cookie, or substituting another ID fails. Preview and resume share the existing 120-per-minute/IP preview bucket.

Registration accepts either the existing `invitationToken` or `invitationContextId`. Authenticated acceptance accepts either `token` or `invitationContextId`; the legacy staff acceptance route still supports a server-bound pending invitation with neither. Raw and continuation references cannot be combined. The API resolves continuations internally before calling the existing registration/acceptance services, preserving transaction-time invitation validation and account/membership rules.

Successful registration clears the tab's join reference and leaves email verification recovery responsible for the next stage. Successful login/acceptance clears the reference too. PINs, passwords, OTPs, and unsent form values are never persisted. Refresh before registration restores the invitation/team, but users re-enter unsent form values. Refresh after registration restores the pending email and resend cooldown without submitting anything automatically. Cookies expire naturally; clearing tab hints does not invalidate another tab's cookie.

## Failure behavior and UI

- `INVITATION_CONTEXT_EXPIRED`: saved continuation is missing, expired, or invalid. Clear the tab hint and tell the user to reopen their original team link. Do not imply the underlying invitation was revoked.
- `INVITATION_INVALID`: the underlying invitation is expired, revoked, unavailable, or has been consumed. Ask the user for a new link where appropriate.
- Network errors and throttling preserve the in-memory reference and provide an explicit retry. No automatic registration or invitation acceptance is performed.
- If browser storage or cookies are unavailable, the original link remains the fallback. The current in-memory registration flow stays usable when storage is blocked.

Account-access footer actions use separate full-width rows with 12px gaps, wrapping text, and at least 44px touch targets. Verification, role-switching and back-to-sign-in controls no longer share an inline row. Recovery controls are disabled while an authentication request is pending.

## Deployment and verification

Deploy the backend and frontend together, preferably backend first. No new database migration, infrastructure service, or environment key is required. Existing replicas must share the same data-encryption secret; rotating it invalidates pending continuations, and users can reopen their original links.

Tests cover cookie flags, expiry, tampering, missing cookies, role/email binding, revocation, multi-context isolation, registration and authenticated acceptance after refresh, client hint expiry, player OTP refresh, and footer layout at phone/tablet/desktop widths. Run the normal backend suite and browser tests before release.
