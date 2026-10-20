'use client';
import { PASSWORD_PATTERN } from '@pitchpresence/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import type { AuthResponse, RegistrationResponse } from '@pitchpresence/shared';
import { api, RequestError, setCsrfToken } from '@/lib/api';
import {
  pendingVerification,
  rememberVerification,
  forgetVerification,
  pendingInvitationContext,
  rememberInvitationContext,
  forgetInvitationContext,
} from '@/lib/onboarding';
import { safeReturn } from '@/lib/format';
import { Button, Feedback, Field, Logo } from './ui';
import { HeroFilm } from './hero-film';
export type AuthSession = AuthResponse;
export function sessionHome(session: AuthSession) {
  if (session.user.role === 'PLAYER') return '/home';
  return session.nextStep === 'READY'
    ? '/management'
    : session.nextStep === 'ACCEPT_INVITATION'
      ? '/onboarding/staff-invitation'
      : '/onboarding/team';
}
export function AuthForm({
  mode = 'sign-in',
  onAuthenticated,
}: {
  mode?: string;
  onAuthenticated?: (session: AuthSession) => void;
}) {
  const player = ['player/sign-in', 'register', 'reset-pin'].includes(mode);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');
  const [stage, setStage] = useState(
    ['register', 'signup', 'staff/join'].includes(mode)
      ? 'register'
      : ['reset-pin', 'forgot-password'].includes(mode)
        ? 'request'
        : mode === 'verify-email'
          ? 'verify'
          : 'login',
  );
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [credential, setCredential] = useState('');
  const [show, setShow] = useState(false);
  const [loginWithPassword, setLoginWithPassword] = useState(!player);
  const [joinPin, setJoinPin] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [invite, setInvite] = useState('');
  const [invitationContextId, setInvitationContextId] = useState('');
  const hasInvitation = !!(invite || invitationContextId);
  const invitationRole = player ? 'PLAYER' : 'MANAGER';
  const [invalidInvite, setInvalidInvite] = useState(false);
  const [existing, setExisting] = useState<AuthSession | null>(null);
  const [preview, setPreview] = useState<{
    teamId?: string;
    teamName: string;
    email: string | null;
    kind: 'MANAGER' | 'PLAYER';
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resendDeadline, setResendDeadline] = useState(0);
  const [waits, setWaits] = useState<Record<string, number>>({});
  const [throttledAction, setThrottledAction] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const remaining = (deadline: number) => Math.max(0, Math.ceil((deadline - now) / 1000));
  const cooldown = remaining(resendDeadline);
  const actionWait = (action: string) => remaining(waits[action] ?? 0);
  const invitedMembership = preview?.teamId
    ? existing?.memberships?.find((membership) => membership.teamId === preview.teamId)
    : undefined;
  const alreadyMember =
    invitedMembership ??
    (preview?.teamId && existing?.user.teamId === preview.teamId
      ? { active: existing.user.active, removedAt: existing.user.removedAt }
      : undefined);
  function setCooldown(seconds: number) {
    setResendDeadline(Date.now() + seconds * 1000);
    setNow(Date.now());
  }
  function failure(e: unknown, action: string) {
    if (e instanceof RequestError && e.status === 429 && e.retryAfterSeconds) {
      setWaits((previous) => ({ ...previous, [action]: Date.now() + e.retryAfterSeconds! * 1000 }));
      setNow(Date.now());
      setThrottledAction(action);
      setError(null);
      if (action === 'resend') setCooldown(e.retryAfterSeconds);
    } else {
      setThrottledAction(null);
      setError((e as Error).message);
    }
  }
  async function checkInvitation(token: string, contextId = invitationContextId) {
    setPreviewBusy(true);
    setPreviewFailed(false);
    setError(null);
    setThrottledAction(null);
    try {
      const data = await api<{
        teamId?: string;
        teamName: string;
        email: string | null;
        kind: 'MANAGER' | 'PLAYER';
        contextId?: string;
        contextExpiresAt?: string;
      }>(
        token
          ? `/invitations/preview?token=${encodeURIComponent(token)}`
          : `/invitations/resume?context=${encodeURIComponent(contextId)}`,
      );
      if (data.kind !== (player ? 'PLAYER' : 'MANAGER')) {
        setInvalidInvite(true);
        setError('Open the invitation page for your role, or ask your team for a new link.');
        return;
      }
      setPreview(data);
      if (data.contextId && data.contextExpiresAt) {
        setInvitationContextId(data.contextId);
        rememberInvitationContext(invitationRole, data.contextId, data.contextExpiresAt);
      }
      if (data.email) setEmail(data.email);
    } catch (e) {
      if (e instanceof RequestError && e.code === 'INVITATION_CONTEXT_EXPIRED') {
        forgetInvitationContext(invitationRole);
        setInvitationContextId('');
        setInvalidInvite(false);
      } else if (e instanceof RequestError && e.status === 422) {
        setInvalidInvite(true);
        forgetInvitationContext(invitationRole);
      } else setPreviewFailed(true);
      failure(e, 'preview');
    } finally {
      setPreviewBusy(false);
    }
  }
  const inviteCaptured = useRef(false);
  const originalInvite = useRef('');
  function verification(address: string, resendAfterSeconds?: number) {
    const role = player ? 'PLAYER' : 'MANAGER';
    const previous = pendingVerification(role);
    const remaining =
      previous?.email === address.trim().toLowerCase()
        ? Math.max(0, Math.ceil((previous.resendAt - Date.now()) / 1000))
        : 0;
    const saved = rememberVerification(address, role, resendAfterSeconds ?? remaining);
    setEmail(saved.email);
    setPendingEmail(saved.email);
    setCredential('');
    setOtp('');
    setStage('verify');
    setCooldown(Math.max(0, Math.ceil((saved.resendAt - Date.now()) / 1000)));
    setError(null);
  }
  async function loadAuth() {
    setAuthLoaded(false);
    setAuthError(null);
    try {
      const session = await api<AuthSession>('/auth/me');
      setCsrfToken(session.csrfToken, session.user.id);
      if (['staff/join', 'register'].includes(mode) && originalInvite.current) {
        setExisting(session);
      } else if (
        !onAuthenticated &&
        ['signup', 'register', 'verify-email', 'sign-in', 'player/sign-in'].includes(mode)
      ) {
        forgetVerification(session.user.role, session.user.email);
        location.replace(sessionHome(session));
      }
    } catch (e) {
      if (e instanceof RequestError && e.code === 'PLAYER_REMOVED') {
        setCsrfToken(null);
        if (player) setError(e.message);
      } else if (!(e instanceof RequestError && e.status === 401))
        setAuthError((e as Error).message);
    } finally {
      setAuthLoaded(true);
    }
  }
  useEffect(() => {
    if (!inviteCaptured.current)
      originalInvite.current =
        new URLSearchParams(location.search).get('invite') ??
        (pendingVerification(invitationRole)
          ? ''
          : (pendingInvitationContext(invitationRole)?.id ?? ''));
    const saved = pendingVerification(player ? 'PLAYER' : 'MANAGER');
    if (saved) {
      setPendingEmail(saved.email);
      if (
        ['signup', 'register', 'staff/join', 'verify-email'].includes(mode) &&
        !new URLSearchParams(location.search).has('invite')
      ) {
        setEmail(saved.email);
        setStage('verify');
        setCooldown(Math.max(0, Math.ceil((saved.resendAt - Date.now()) / 1000)));
        setMessage('Continue your email verification. Use your latest code, or request a new one.');
      }
    }
    void loadAuth();
  }, [mode]);
  useEffect(() => {
    if (['register', 'staff/join'].includes(mode) && !inviteCaptured.current) {
      inviteCaptured.current = true;
      const token = new URLSearchParams(location.search).get('invite') ?? '';
      setInvite(token);
      if (token) {
        forgetInvitationContext(invitationRole);
        history.replaceState(null, '', '/' + mode);
        void checkInvitation(token);
      } else if (!pendingVerification(invitationRole)) {
        const saved = pendingInvitationContext(invitationRole);
        if (saved) {
          setInvitationContextId(saved.id);
          void checkInvitation('', saved.id);
        }
      }
    }
  }, [mode]);
  useEffect(() => {
    if (!resendDeadline && !Object.values(waits).some((deadline) => deadline > Date.now())) return;
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, [resendDeadline, waits]);
  async function authenticated(session: AuthSession, acceptInvite = true) {
    setCsrfToken(session.csrfToken, session.user.id);
    forgetVerification(session.user.role, session.user.email);
    if (hasInvitation && acceptInvite) {
      if (
        preview?.teamId &&
        (session.user.teamId === preview.teamId ||
          session.memberships?.some((membership) => membership.teamId === preview.teamId))
      ) {
        setExisting(session);
        return;
      }
      try {
        if (session.memberships || player) {
          session = await api<AuthSession>('/auth/invitations/accept', {
            method: 'POST',
            body: {
              ...(invite ? { token: invite } : { invitationContextId }),
              ...(joinPin ? { pin: joinPin } : {}),
              ...(joinPassword ? { password: joinPassword } : {}),
            },
          });
          setCsrfToken(session.csrfToken, session.user.id);
        } else {
          await api('/auth/staff-invitation/accept', {
            method: 'POST',
            body: invite ? { token: invite } : { invitationContextId },
          });
          session = await api<AuthSession>('/auth/me');
        }
      } catch (e) {
        if (e instanceof RequestError && e.status === 404) {
          throw new Error(
            'Team invitation acceptance is unavailable on the server. Your team membership has not been changed. Ask the app administrator to check the backend deployment.',
          );
        }
        if (
          e instanceof RequestError &&
          (e.code === 'PIN_REQUIRED' || e.code === 'PASSWORD_REQUIRED')
        ) {
          setExisting(session);
          setCredential('');
          setError(e.message);
          return;
        }
        if (!player && session.nextStep === 'ACCEPT_INVITATION') {
          location.assign('/onboarding/staff-invitation');
          return;
        }
        throw e;
      }
    }
    forgetInvitationContext(invitationRole);
    if (onAuthenticated) onAuthenticated(session);
    else {
      const requested = safeReturn(new URLSearchParams(location.search).get('returnTo'));
      const allowed =
        session.nextStep === 'READY' &&
        requested &&
        (session.user.role === 'MANAGER'
          ? requested.startsWith('/management') || requested === '/account'
          : ['/home', '/attendance', '/dues', '/account', '/check-in', '/profile'].includes(
              requested,
            ));
      location.assign(allowed ? requested : sessionHome(session));
    }
  }
  const resetKind = player ? 'pin' : 'password';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || busy || actionWait(stage) > 0) return;
    submitting.current = true;
    setThrottledAction(null);
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (stage === 'login')
        await authenticated(
          await api<AuthSession>(loginWithPassword ? '/auth/staff-login' : '/auth/device-login', {
            method: 'POST',
            body: loginWithPassword ? { email, password: credential } : { email, pin: credential },
          }),
        );
      else if (stage === 'register') {
        const result = await api<RegistrationResponse>(
          player ? '/auth/register' : '/auth/staff-register',
          {
            method: 'POST',
            body: player
              ? {
                  name,
                  email,
                  pin: credential,
                  ...(invite ? { invitationToken: invite } : { invitationContextId }),
                }
              : {
                  name,
                  email,
                  password: credential,
                  ...(invite
                    ? { invitationToken: invite }
                    : invitationContextId
                      ? { invitationContextId }
                      : {}),
                },
          },
        );
        verification(email, result.resendAfterSeconds ?? 60);
        forgetInvitationContext(invitationRole);
        setMessage(result.message);
      } else if (stage === 'verify') {
        let session: AuthSession;
        try {
          session = await api<AuthSession>('/auth/verify-email', {
            method: 'POST',
            body: { email, otp },
          });
        } catch (verificationError) {
          // A consumed code or lost response can follow successful verification on this device.
          // Only the server's matching, verified session can establish that success.
          if (
            !(verificationError instanceof RequestError) ||
            (verificationError.code !== 'OTP_INVALID' && verificationError.status !== 0)
          )
            throw verificationError;
          const recovered = await api<AuthSession>('/auth/me').catch(() => null);
          if (
            !recovered ||
            !recovered.user.isVerified ||
            !recovered.user.active ||
            recovered.user.email.toLowerCase() !== email.trim().toLowerCase() ||
            recovered.user.role !== (player ? 'PLAYER' : 'MANAGER')
          )
            throw verificationError;
          session = recovered;
        }
        // Player registration already creates the invited membership before email verification.
        await authenticated(session, !(player && mode === 'register'));
      } else if (stage === 'request') {
        await api(`/auth/${resetKind}-reset/request`, { method: 'POST', body: { email } });
        setStage('reset');
        setCooldown(60);
        setMessage('If your account is eligible, a reset code will arrive by email.');
      } else {
        await api(`/auth/${resetKind}-reset/confirm`, {
          method: 'POST',
          body: player ? { email, otp, pin: credential } : { email, otp, password: credential },
        });
        setCredential('');
        setOtp('');
        setStage('login');
        setMessage(`${player ? 'PIN' : 'Password'} changed. Sign in again on your devices.`);
      }
    } catch (e) {
      if (
        stage === 'login' &&
        e instanceof RequestError &&
        e.code === 'EMAIL_VERIFICATION_REQUIRED'
      ) {
        verification(email);
        setMessage('Your account is saved. Enter your latest email code, or request a new one.');
      } else if (
        stage === 'register' &&
        hasInvitation &&
        e instanceof RequestError &&
        e.code === 'ACCOUNT_EXISTS'
      ) {
        setStage('login');
        setCredential('');
        setMessage(
          'Your account already exists. Sign in to join this team without creating another account.',
        );
      } else failure(e, stage);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function resend() {
    if (cooldown > 0 || actionWait('resend') > 0) return;
    setThrottledAction(null);
    setBusy(true);
    setError(null);
    try {
      await api(stage === 'verify' ? '/auth/resend-otp' : `/auth/${resetKind}-reset/request`, {
        method: 'POST',
        body: { email },
      });
      if (stage === 'verify') verification(email, 60);
      else setCooldown(60);
      setMessage('A new code has been requested. Check your email.');
    } catch (e) {
      failure(e, 'resend');
    } finally {
      setBusy(false);
    }
  }
  const needsInvite =
    stage !== 'verify' &&
    ['register', 'staff/join'].includes(mode) &&
    (!hasInvitation || invalidInvite || previewFailed || previewBusy || !preview);
  return (
    <div className="auth-form">
      <p className="eyebrow">
        {player ? 'PLAYER ACCESS' : 'COACHES & MANAGERS'}
        {preview ? ` / ${preview.teamName}` : ''}
      </p>
      <h1>
        {stage === 'login'
          ? 'BACK TO THE TEAM.'
          : stage === 'register'
            ? player || hasInvitation
              ? 'YOUR TEAM IS WAITING.'
              : 'MAKE ROOM FOR FOOTBALL.'
            : stage === 'verify'
              ? 'MAKE IT OFFICIAL.'
              : 'A FRESH START.'}
      </h1>
      <p>
        {stage === 'login'
          ? player
            ? 'Your attendance and dues, with your email and four-digit PIN.'
            : 'Sign in with your email and password to manage your team.'
          : stage === 'register'
            ? player
              ? 'Create your player account using your team invitation.'
              : hasInvitation
                ? 'Join your team as a coach or manager. Both have full management access.'
                : 'Create your staff account, verify your email, then name your team.'
            : stage === 'verify'
              ? 'Enter the six-digit code from your email. You can return here to finish verification.'
              : 'Recover your account with a code sent to your email.'}
      </p>
      <Feedback
        error={
          throttledAction
            ? actionWait(throttledAction) > 0
              ? `Too many attempts. Try again in ${actionWait(throttledAction)}s.`
              : 'You can try again now.'
            : (error ?? authError)
        }
        success={message}
      />
      {previewFailed && !invalidInvite && (
        <Button
          variant="secondary"
          busy={previewBusy}
          disabled={actionWait('preview') > 0}
          onClick={() => checkInvitation(invite)}
        >
          {actionWait('preview')
            ? `Retry invitation check in ${actionWait('preview')}s`
            : 'Retry invitation check'}
        </Button>
      )}
      {authError && (
        <Button variant="secondary" onClick={loadAuth}>
          Retry connection
        </Button>
      )}
      {existing && alreadyMember && ['staff/join', 'register'].includes(mode) ? (
        <div className="form-stack">
          <p role="status">
            {alreadyMember.removedAt
              ? `You were removed from ${preview?.teamName}. Contact the team manager to request access again.`
              : !alreadyMember.active
                ? `Your membership in ${preview?.teamName} is inactive. Contact the team manager to restore access.`
                : `This account is already part of ${preview?.teamName}. You do not need to accept this invitation again.`}
          </p>
          {alreadyMember.active && !alreadyMember.removedAt && (
            <p>
              {existing.user.teamId === preview?.teamId
                ? 'Continue in your existing team workspace.'
                : 'Open your workspace and use Switch team to select this team.'}
            </p>
          )}
          <Link className="button primary" href={sessionHome(existing)}>
            Go to my workspace
          </Link>
        </div>
      ) : existing && ['staff/join', 'register'].includes(mode) ? (
        <div className="form-stack">
          <p>
            Signed in as {existing.user.email}. Join {preview?.teamName ?? 'this team'} as{' '}
            {player ? 'a player' : 'team staff'}.
          </p>
          {player &&
            (existing.hasPlayerPin === false ||
              (existing.hasPlayerPin === undefined && existing.user.role === 'MANAGER')) && (
              <Field
                label="Choose your player PIN"
                inputMode="numeric"
                type="password"
                pattern="[0-9]{4}"
                maxLength={4}
                value={joinPin}
                onChange={(e) => setJoinPin(e.target.value.replace(/\D/g, ''))}
                required
              />
            )}
          {!player && existing.authMethod === 'PIN' && (
            <>
              <Field
                label="Account password"
                type="password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
              />
              <Link href="/forgot-password">Set or recover a password through email</Link>
            </>
          )}
          <Button
            busy={busy}
            disabled={
              !hasInvitation ||
              invalidInvite ||
              previewFailed ||
              previewBusy ||
              !preview ||
              (player && existing.hasPlayerPin === false && joinPin.length !== 4) ||
              (!player && existing.authMethod === 'PIN' && !joinPassword)
            }
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await authenticated(existing);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Accept invitation
          </Button>
          <Button
            variant="secondary"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api('/auth/logout', { method: 'POST', body: {} });
                setCsrfToken(null);
                setExisting(null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Use a different account
          </Button>
        </div>
      ) : needsInvite ? (
        <div className="notice">
          {previewBusy
            ? 'Checking your invitation…'
            : previewFailed
              ? 'Retry checking your invitation to continue.'
              : invalidInvite
                ? 'Ask your coach or manager for a new invitation link.'
                : 'Reopen the original invitation link shared by your team. If you already registered, choose Verify your email below to continue.'}
        </div>
      ) : (
        <form onSubmit={submit} className="form-stack">
          {stage === 'register' && (
            <Field
              label="Your name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
            />
          )}
          <Field
            label="Email address"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={stage === 'reset' || !!preview?.email}
            required
          />
          {['verify', 'reset'].includes(stage) && (
            <Field
              label="Six-digit email code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              className="numeric-input"
              required
            />
          )}
          {['login', 'register', 'reset'].includes(stage) && (
            <>
              <Field
                label={
                  (stage === 'login' ? !loginWithPassword : player)
                    ? stage === 'login'
                      ? 'Four-digit PIN'
                      : 'Choose a four-digit PIN'
                    : stage === 'login'
                      ? 'Password'
                      : 'Choose a password'
                }
                type={show ? 'text' : 'password'}
                inputMode={
                  (stage === 'login' ? !loginWithPassword : player) ? 'numeric' : undefined
                }
                autoComplete={stage === 'login' ? 'current-password' : 'new-password'}
                pattern={
                  stage === 'login'
                    ? loginWithPassword
                      ? undefined
                      : '[0-9]{4}'
                    : player
                      ? '[0-9]{4}'
                      : PASSWORD_PATTERN
                }
                minLength={stage === 'login' ? (loginWithPassword ? 1 : 4) : player ? 4 : 8}
                maxLength={(stage === 'login' ? !loginWithPassword : player) ? 4 : 128}
                value={credential}
                onChange={(e) =>
                  setCredential(
                    (stage === 'login' ? !loginWithPassword : player)
                      ? e.target.value.replace(/\D/g, '')
                      : e.target.value,
                  )
                }
                help={
                  !player && stage !== 'login'
                    ? 'At least 8 characters: uppercase, lowercase, number and symbol.'
                    : undefined
                }
                required
              />
              <button
                type="button"
                className="text-action"
                aria-pressed={show}
                onClick={() => setShow(!show)}
              >
                {show ? 'Hide' : 'Show'}{' '}
                {(stage === 'login' ? !loginWithPassword : player) ? 'PIN' : 'password'}
              </button>
            </>
          )}
          {stage === 'login' && hasInvitation && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setLoginWithPassword(!loginWithPassword);
                setCredential('');
              }}
            >
              {loginWithPassword ? 'Use player PIN instead' : 'Use account password instead'}
            </Button>
          )}
          {stage === 'login' && (
            <Link
              className="form-link"
              href={loginWithPassword ? '/forgot-password' : '/reset-pin'}
            >
              Forgot your {loginWithPassword ? 'password' : 'PIN'}?
            </Link>
          )}
          <Button
            type="submit"
            busy={busy}
            disabled={!authLoaded || !!authError || actionWait(stage) > 0}
          >
            {stage === 'login'
              ? 'Sign in'
              : stage === 'register'
                ? player
                  ? 'Create player account'
                  : 'Create staff account'
                : stage === 'verify'
                  ? 'Verify email'
                  : stage === 'request'
                    ? 'Send reset code'
                    : `Save new ${resetKind}`}
          </Button>
          {['verify', 'reset'].includes(stage) && (
            <Button
              type="button"
              variant="secondary"
              onClick={resend}
              disabled={cooldown > 0 || busy || !authLoaded || !!authError}
            >
              {cooldown ? `Resend code in ${cooldown}s` : 'Resend email code'}
            </Button>
          )}
        </form>
      )}
      <nav className="auth-navigation" aria-label="Account access options">
        {!existing && ['login', 'register'].includes(stage) && (
          <button
            type="button"
            className="text-action"
            disabled={busy || !authLoaded || !!authError}
            onClick={() => {
              verification(email || pendingEmail);
              setMessage('Enter your email and request a new verification code.');
            }}
          >
            {pendingEmail ? 'Continue email verification' : 'Verify your email'}
          </button>
        )}
        {mode === 'staff/join' && !existing && (
          <button
            type="button"
            className="text-action"
            disabled={busy || !authLoaded || !!authError}
            onClick={() => {
              setStage(stage === 'login' ? 'register' : 'login');
              setCredential('');
              setError(null);
            }}
          >
            {stage === 'login' ? 'Create a staff account' : 'Already have an account? Sign in'}
          </button>
        )}
        {mode === 'sign-in' && (
          <p className="auth-help">
            <Link href="/signup">Create your team</Link> ·{' '}
            <Link href="/player/sign-in">Player sign in</Link>
          </p>
        )}
        {stage !== 'login' && mode !== 'staff/join' && (
          <Link className="text-action" href={player ? '/player/sign-in' : '/sign-in'}>
            <ArrowLeft size={16} /> Back to sign in
          </Link>
        )}
      </nav>
      <div className="auth-security">
        <ShieldCheck size={18} />
        <span>Your records, securely kept together.</span>
      </div>
    </div>
  );
}
export function AuthPage({ mode }: { mode: string }) {
  return (
    <main id="main" className="auth-layout">
      <div className="auth-side">
        <Logo />
        <HeroFilm
          presentation="split"
          fallbackKind={['register', 'signup'].includes(mode) ? 'training' : 'coach'}
        />
        <div className="auth-photo-caption">
          <span className="eyebrow">SHOW UP. GET STUCK IN.</span>
          <h2>
            THE TEAM.
            <br />
            THE TRAINING.
            <br />
            THE LITTLE DETAILS.
          </h2>
          <p>
            Keep the records.
            <br />
            Get back to football.
          </p>
        </div>
      </div>
      <div className="auth-main">
        <div className="auth-mobile-logo">
          <Logo />
        </div>
        <AuthForm key={mode} mode={mode} />
        <Link className="back-home" href="/">
          <ArrowLeft size={16} />
          Back to PitchPresence
        </Link>
      </div>
    </main>
  );
}
