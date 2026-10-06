'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import type { AuthResponse, RegistrationResponse } from '@pitchpresence/shared';
import { api, RequestError, setCsrfToken } from '@/lib/api';
import { pendingVerification, rememberVerification, forgetVerification } from '@/lib/onboarding';
import { safeReturn } from '@/lib/format';
import { Button, Feedback, Field, Logo } from './ui';
import { Photo } from './photo';
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
  const [otp, setOtp] = useState('');
  const [invite, setInvite] = useState('');
  const [invalidInvite, setInvalidInvite] = useState(false);
  const [existing, setExisting] = useState<AuthSession | null>(null);
  const [preview, setPreview] = useState<{
    teamName: string;
    email: string | null;
    kind: 'MANAGER' | 'PLAYER';
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
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
      setCsrfToken(session.csrfToken);
      if (mode === 'staff/join') {
        if (!originalInvite.current && session.nextStep !== 'CREATE_TEAM') {
          forgetVerification(session.user.role, session.user.email);
          location.replace(sessionHome(session));
        } else setExisting(session);
      } else if (
        !onAuthenticated &&
        ['signup', 'register', 'verify-email', 'sign-in', 'player/sign-in'].includes(mode)
      ) {
        forgetVerification(session.user.role, session.user.email);
        location.replace(sessionHome(session));
      }
    } catch (e) {
      if (!(e instanceof RequestError && e.status === 401)) setAuthError((e as Error).message);
    } finally {
      setAuthLoaded(true);
    }
  }
  useEffect(() => {
    originalInvite.current = new URLSearchParams(location.search).get('invite') ?? '';
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
        history.replaceState(null, '', '/' + mode);
        void api<{ teamName: string; email: string | null; kind: 'MANAGER' | 'PLAYER' }>(
          `/invitations/preview?token=${encodeURIComponent(token)}`,
        )
          .then((data) => {
            if (data.kind !== (player ? 'PLAYER' : 'MANAGER')) {
              setInvalidInvite(true);
              setError('Open the invitation page for your role, or ask your team for a new link.');
              return;
            }
            setPreview(data);
            if (data.email) setEmail(data.email);
          })
          .catch((e) => {
            setInvalidInvite(true);
            setError((e as Error).message);
          });
      }
    }
  }, [mode]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function authenticated(session: AuthSession) {
    setCsrfToken(session.csrfToken);
    forgetVerification(session.user.role, session.user.email);
    if (!player && invite) {
      try {
        await api('/auth/staff-invitation/accept', { method: 'POST', body: { token: invite } });
      } catch (e) {
        if (session.nextStep === 'ACCEPT_INVITATION') {
          location.assign('/onboarding/staff-invitation');
          return;
        }
        throw e;
      }
      session = await api<AuthSession>('/auth/me');
    }
    if (onAuthenticated) onAuthenticated(session);
    else {
      const requested = safeReturn(new URLSearchParams(location.search).get('returnTo'));
      const allowed =
        session.nextStep === 'READY' &&
        requested &&
        (session.user.role === 'MANAGER'
          ? requested.startsWith('/management') || requested === '/account'
          : ['/home', '/attendance', '/dues', '/account', '/check-in'].includes(requested));
      location.assign(allowed ? requested : sessionHome(session));
    }
  }
  const resetKind = player ? 'pin' : 'password';
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (stage === 'login')
        await authenticated(
          await api<AuthSession>(player ? '/auth/device-login' : '/auth/staff-login', {
            method: 'POST',
            body: player ? { email, pin: credential } : { email, password: credential },
          }),
        );
      else if (stage === 'register') {
        const result = await api<RegistrationResponse>(
          player ? '/auth/register' : '/auth/staff-register',
          {
            method: 'POST',
            body: player
              ? { name, email, pin: credential, invitationToken: invite }
              : {
                  name,
                  email,
                  password: credential,
                  ...(invite ? { invitationToken: invite } : {}),
                },
          },
        );
        verification(email, result.resendAfterSeconds ?? 60);
        setMessage(result.message);
      } else if (stage === 'verify')
        await authenticated(
          await api<AuthSession>('/auth/verify-email', { method: 'POST', body: { email, otp } }),
        );
      else if (stage === 'request') {
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
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
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
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const needsInvite =
    stage !== 'verify' && ['register', 'staff/join'].includes(mode) && (!invite || invalidInvite);
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
            ? player || invite
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
              : invite
                ? 'Join your team as a coach or manager. Both have full management access.'
                : 'Create your staff account, verify your email, then name your team.'
            : stage === 'verify'
              ? 'Enter the six-digit code from your email. You can return here to finish verification.'
              : 'Recover your account with a code sent to your email.'}
      </p>
      <Feedback error={error ?? authError} success={message} />
      {authError && (
        <Button variant="secondary" onClick={loadAuth}>
          Retry connection
        </Button>
      )}
      {existing && mode === 'staff/join' ? (
        <div className="form-stack">
          <p>Signed in as {existing.user.email}.</p>
          <Button
            busy={busy}
            disabled={!invite || invalidInvite || existing.user.role !== 'MANAGER'}
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
        <div className="notice">Ask your coach or manager for a new invitation link.</div>
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
                  player
                    ? stage === 'login'
                      ? 'Four-digit PIN'
                      : 'Choose a four-digit PIN'
                    : stage === 'login'
                      ? 'Password'
                      : 'Choose a password'
                }
                type={show ? 'text' : 'password'}
                inputMode={player ? 'numeric' : undefined}
                autoComplete={stage === 'login' ? 'current-password' : 'new-password'}
                pattern={player ? '[0-9]{4}' : undefined}
                minLength={player ? 4 : stage === 'login' ? 1 : 15}
                maxLength={player ? 4 : 128}
                value={credential}
                onChange={(e) =>
                  setCredential(player ? e.target.value.replace(/\D/g, '') : e.target.value)
                }
                help={
                  !player && stage !== 'login'
                    ? '15–128 characters. A memorable passphrase works well.'
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
                {show ? 'Hide' : 'Show'} {player ? 'PIN' : 'password'}
              </button>
            </>
          )}
          {stage === 'login' && (
            <Link className="form-link" href={player ? '/reset-pin' : '/forgot-password'}>
              Forgot your {resetKind}?
            </Link>
          )}
          <Button type="submit" busy={busy} disabled={!authLoaded || !!authError}>
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
      {['login', 'register'].includes(stage) && (
        <button
          className="text-action"
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
          className="text-action"
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
        <Photo eager kind={['register', 'signup'].includes(mode) ? 'training' : 'coach'} />
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
