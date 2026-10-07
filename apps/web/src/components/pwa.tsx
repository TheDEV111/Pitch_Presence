'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { api, RequestError } from '@/lib/api';
import { sessionHome, type AuthSession } from './auth';
import { Button, Loading, Logo } from './ui';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
let pendingInstallPrompt: InstallPrompt | null = null;

export function PwaRuntime() {
  const [update, setUpdate] = useState(false);
  useEffect(() => {
    const available = (event: Event) => {
      event.preventDefault();
      pendingInstallPrompt = event as InstallPrompt;
    };
    const done = () => {
      pendingInstallPrompt = null;
    };
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', done);
    return () => {
      window.removeEventListener('beforeinstallprompt', available);
      window.removeEventListener('appinstalled', done);
    };
  }, []);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    let lastCheck = Date.now();
    const check = () => {
      if (!navigator.onLine || document.hidden || Date.now() - lastCheck < 15 * 60 * 1000) return;
      lastCheck = Date.now();
      void registration?.update().catch(() => {});
    };
    const notify = () => {
      if (active && navigator.serviceWorker.controller && registration?.waiting) setUpdate(true);
    };
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((result) => {
        registration = result;
        if (!active) return;
        notify();
        result.addEventListener('updatefound', () => {
          result.installing?.addEventListener('statechange', notify);
        });
      })
      .catch(() => {});
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      active = false;
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  if (!update) return null;
  return (
    <div className="pwa-update notice" role="status">
      <span>
        An update is ready. Finish your current task, then close all PitchPresence windows and
        reopen.
      </span>
      <button
        className="icon-button"
        aria-label="Dismiss update notice"
        onClick={() => setUpdate(false)}
      >
        <X size={18} />
      </button>
    </div>
  );
}

export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(true);
  const [apple, setApple] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const standalone = matchMedia('(display-mode: standalone)');
    const update = () =>
      setInstalled(
        standalone.matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true,
      );
    update();
    setPrompt(pendingInstallPrompt);
    setApple(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    );
    const available = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const done = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', done);
    standalone.addEventListener('change', update);
    return () => {
      window.removeEventListener('beforeinstallprompt', available);
      window.removeEventListener('appinstalled', done);
      standalone.removeEventListener('change', update);
    };
  }, []);
  if (installed) return null;
  async function install() {
    if (!prompt) {
      setHelp(!help);
      return;
    }
    setBusy(true);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      setHelp(true);
    } finally {
      pendingInstallPrompt = null;
      setPrompt(null);
      setBusy(false);
    }
  }
  return (
    <div className="pwa-install">
      <Button variant="secondary" busy={busy} onClick={install}>
        <Download size={17} /> Install PitchPresence
      </Button>
      {help && (
        <p role="status">
          {apple
            ? 'On iPhone or iPad, open this site in Safari, tap Share, then Add to Home Screen and Add.'
            : 'Use your browser’s menu to install this app or add it to your home screen. If that option is unavailable, keep using PitchPresence in this browser.'}
        </p>
      )}
    </div>
  );
}

export function InstalledLaunch() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  async function load() {
    setLoading(true);
    setError(false);
    try {
      window.location.replace(sessionHome(await api<AuthSession>('/auth/me')));
    } catch (e) {
      if (!(e instanceof RequestError && e.status === 401)) setError(true);
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <main id="main" className="not-found">
      <Logo />
      {loading ? (
        <Loading />
      ) : error ? (
        <>
          <h1>Let’s reconnect.</h1>
          <p>Reconnect to access your team. Attendance and payments require internet.</p>
          <Button onClick={load}>Retry connection</Button>
        </>
      ) : (
        <>
          <h1>Your team. One tap away.</h1>
          <p>Choose how you access PitchPresence.</p>
          <div className="actions">
            <Link className="button primary" href="/sign-in">
              Coach / manager sign in
            </Link>
            <Link className="button secondary" href="/player/sign-in">
              Player sign in
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
