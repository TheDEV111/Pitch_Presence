'use client';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Feedback, Loading } from './ui';

type Settings = { available: boolean; publicKey: string | null; enabled: boolean };
function decodeKey(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
function appleDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
async function activeWorker() {
  await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('The app is updating. Close and reopen it, then try again.')),
          10000,
        );
      }),
    ]);
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        reject(
          new Error(
            'Close all PitchPresence windows and reopen the app to finish its notification update.',
          ),
        );
      }, 3000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        channel.port1.close();
        if (event.data?.receipts) resolve();
        else reject(new Error('Update PitchPresence before enabling notifications.'));
      };
      registration.active?.postMessage({ type: 'RECEIPT_PUSH_CAPABILITIES' }, [channel.port2]);
    });
    return registration;
  } finally {
    clearTimeout(timeout);
  }
}

export function ReceiptNotifications() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [supported, setSupported] = useState(false);
  const [apple, setApple] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function load() {
    setError(null);
    try {
      const value = await api<Settings>('/management/notifications/push');
      if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const local = await registration?.pushManager.getSubscription();
        value.enabled = value.enabled && !!local && Notification.permission === 'granted';
        setBlocked(Notification.permission === 'denied');
      } else value.enabled = false;
      setSettings(value);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setSupported(
      window.isSecureContext &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window,
    );
    setApple(appleDevice());
    void load();
  }, []);
  async function enable() {
    if (!settings?.publicKey || !supported) return;
    // Request permission directly from the click, before network/worker awaits (required on iOS).
    setBusy(true);
    setError(null);
    setMessage(null);
    let created: PushSubscription | null = null;
    try {
      const permission =
        Notification.permission === 'granted'
          ? Promise.resolve('granted')
          : Notification.requestPermission();
      const allowed = await permission;
      setBlocked(allowed === 'denied');
      if (allowed !== 'granted')
        throw new Error(
          'Notifications were not enabled. You can allow them in your browser or device settings.',
        );
      const registration = await activeWorker();
      let subscription = await registration.pushManager.getSubscription();
      const publicKey = decodeKey(settings.publicKey);
      const savedKey = subscription?.options.applicationServerKey;
      if (
        subscription &&
        (!savedKey || !publicKey.every((byte, i) => new Uint8Array(savedKey)[i] === byte))
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
        created = subscription;
      }
      const data = subscription.toJSON();
      await api('/management/notifications/push', {
        method: 'POST',
        body: { endpoint: data.endpoint, keys: data.keys },
      });
      setSettings({ ...settings, enabled: true });
      setMessage('Receipt notifications are enabled on this device while you stay signed in.');
    } catch (e) {
      // A failed registration must never claim success; a retry can register an existing subscription.
      if (created) await created.unsubscribe().catch(() => {});
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api('/management/notifications/push', { method: 'DELETE' });
      setSettings((value) => (value ? { ...value, enabled: false } : value));
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      const notifications = await registration?.getNotifications();
      notifications?.forEach((notice) => notice.close());
      setMessage('Receipt notifications are disabled on this device.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-labelledby="receipt-notifications-title">
      <Bell size={26} />
      <h2 id="receipt-notifications-title">Receipt notifications</h2>
      <p>
        Get a device notification when a player submits payment proof. Tap it to open the dues list
        and review the receipt.
      </p>
      <p className="helper">
        Notifications show no player names, amounts or bank details. Enable them separately on each
        device; signing out ends delivery.
      </p>
      <Feedback error={error} success={message} />
      {!settings ? (
        error ? (
          <Button variant="secondary" onClick={load}>
            Retry notification settings
          </Button>
        ) : (
          <Loading />
        )
      ) : !settings.available ? (
        <p role="status">Device notifications will be available once the server is configured.</p>
      ) : !supported ? (
        <p role="status">
          {apple
            ? 'Add PitchPresence to your Home Screen using Safari, open it from its icon, then enable notifications here. Requires iOS or iPadOS 16.4 or later.'
            : 'This browser does not support device notifications here. Use a supported browser over HTTPS.'}
        </p>
      ) : (
        <>
          {blocked && (
            <p role="status">
              Notifications are blocked. Allow them for PitchPresence in your browser or device
              settings, then retry.
            </p>
          )}
          <Button variant="secondary" busy={busy} onClick={settings.enabled ? disable : enable}>
            {settings.enabled ? 'Disable receipt notifications' : 'Enable receipt notifications'}
          </Button>
        </>
      )}
    </section>
  );
}
