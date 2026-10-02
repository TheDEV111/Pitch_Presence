'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ClipboardList, Home, LogOut, ScanLine, ShieldCheck, Users, Wallet } from 'lucide-react';
import type { UserResponse } from '@pitchpresence/shared';
import { api, RequestError, setCsrfToken } from '@/lib/api';
import { TeamOnboarding, TeamSettingsPage } from './team';
import { AuthPage, sessionHome, type AuthSession } from './auth';
import { Button, Feedback, Loading, Logo } from './ui';
import { PlayerHome, Attendance, PlayerDues, PaymentReturn, CheckIn } from './player';
import { ManagementHome, Training, TrainingSession } from './training';
import { Players, ManagementDues, Audit, Account } from './management';
const playerNav = [
  { href: '/home', name: 'Home', icon: Home },
  { href: '/attendance', name: 'Attendance', icon: ScanLine },
  { href: '/dues', name: 'Dues', icon: Wallet },
  { href: '/account', name: 'Account', icon: ShieldCheck },
];
const managerNav = [
  { href: '/management', name: 'Overview', icon: Home },
  { href: '/management/training', name: 'Training', icon: ClipboardList },
  { href: '/management/players', name: 'Players', icon: Users },
  { href: '/management/dues', name: 'Dues', icon: Wallet },
];
export function Application({ route }: { route: string }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<UserResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signInPath, setSignInPath] = useState(
    ['home', 'attendance', 'dues', 'dues/payment-return', 'check-in'].includes(route)
      ? '/player/sign-in'
      : '/sign-in',
  );
  const [expired, setExpired] = useState(false);
  const [online, setOnline] = useState(true);
  const publicAuth = [
    'sign-in',
    'player/sign-in',
    'register',
    'signup',
    'staff/join',
    'verify-email',
    'forgot-password',
    'reset-pin',
  ].includes(route);
  function authenticated(session: AuthSession) {
    setSession(session);
    setSignInPath(session.user.role === 'MANAGER' ? '/sign-in' : '/player/sign-in');
    setUser(session.user);
    setCsrfToken(session.csrfToken);
    setExpired(false);
  }
  async function load() {
    setLoading(true);
    setError(null);
    try {
      authenticated(await api<AuthSession>('/auth/me'));
    } catch (e) {
      if (!(e instanceof RequestError && e.status === 401)) setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (!publicAuth) void load();
    else setLoading(false);
    const onExpire = () => {
      setExpired(true);
      setUser(null);
      setSession(null);
      setCsrfToken(null);
    };
    const connection = () => setOnline(navigator.onLine);
    connection();
    window.addEventListener('session-expired', onExpire);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    return () => {
      window.removeEventListener('session-expired', onExpire);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    };
    // Each navigation mounts a fresh application; authentication is kept in memory only.
  }, []);
  if (publicAuth) return <AuthPage mode={route} />;
  if (route === 'check-in')
    return <CheckIn user={user} loading={loading} error={error} authenticated={authenticated} />;
  if (loading)
    return (
      <main id="main">
        <Loading />
      </main>
    );
  if (!user)
    return (
      <main id="main" className="not-found">
        <Logo />
        <h1>
          {expired
            ? 'Sign in again.'
            : error
              ? 'Let’s reconnect.'
              : 'Your team is one sign-in away.'}
        </h1>
        <Feedback error={error} />
        {error ? (
          <Button onClick={load}>Try again</Button>
        ) : (
          <Link
            className="button primary"
            href={`${signInPath}?returnTo=${encodeURIComponent('/' + route)}`}
          >
            Sign in
          </Link>
        )}
      </main>
    );
  if (session && session.nextStep !== 'READY') return <TeamOnboarding session={session} />;
  if (route.startsWith('onboarding/') && session)
    return (
      <main id="main" className="not-found">
        <h1>Your team is ready.</h1>
        <Link className="button primary" href={sessionHome(session)}>
          Open your dashboard
        </Link>
      </main>
    );
  const manager = user.role === 'MANAGER';
  if (
    (route.startsWith('management') && !manager) ||
    (['home', 'attendance', 'dues', 'dues/payment-return'].includes(route) && manager)
  )
    return (
      <main id="main" className="not-found">
        <h1>This page belongs to a different role.</h1>
        <Link className="button primary" href={manager ? '/management' : '/home'}>
          Open your dashboard
        </Link>
      </main>
    );
  const links = manager ? managerNav : playerNav;
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
      setCsrfToken(null);
      location.assign(manager ? '/sign-in' : '/player/sign-in');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  let content;
  if (route === 'home') content = <PlayerHome user={user} />;
  else if (route === 'attendance') content = <Attendance />;
  else if (route === 'dues') content = <PlayerDues user={user} />;
  else if (route === 'dues/payment-return') content = <PaymentReturn />;
  else if (route === 'management') content = <ManagementHome user={user} />;
  else if (route === 'management/training') content = <Training />;
  else if (route.startsWith('management/training/'))
    content = <TrainingSession id={route.split('/')[2]} />;
  else if (route === 'management/team') content = <TeamSettingsPage />;
  else if (route === 'management/players') content = <Players />;
  else if (route === 'management/dues') content = <ManagementDues />;
  else if (route === 'management/audit') content = <Audit />;
  else content = <Account user={user} />;
  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <Logo />
        <p className="workspace-label">{manager ? 'MANAGEMENT' : 'PLAYER'} WORKSPACE</p>
        <nav aria-label="Team navigation">
          {links.map((item) => {
            const active =
              item.href === '/management'
                ? route === 'management'
                : ('/' + route).startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
                <item.icon size={21} />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          {manager && (
            <>
              <Link href="/management/team">Team settings</Link>
              <Link href="/management/audit">Activity log</Link>
              <Link href="/account">Account & devices</Link>
            </>
          )}
          <div className="sidebar-user">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{manager ? 'Team manager' : 'Team player'}</small>
            </div>
          </div>
          <button className="text-action" onClick={logout}>
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="app-content">
        <header className="app-topbar">
          <span className="eyebrow">{session?.team?.name ?? 'PitchPresence'}</span>
          <Link href="/account" className="topbar-user" aria-label={`Account for ${user.name}`}>
            <span className="live-dot" />
            {user.name}
          </Link>
        </header>
        <main id="main" className="app-main">
          {!online && (
            <div className="notice" role="status">
              You’re offline. These records may be out of date. Reconnect before making changes.
            </div>
          )}
          <Feedback error={error} />
          {content}
        </main>
      </div>
    </div>
  );
}
