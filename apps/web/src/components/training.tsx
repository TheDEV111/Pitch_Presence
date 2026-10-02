'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { Check, MapPin, Maximize2, ScanLine } from 'lucide-react';
import type { TrainingResponse, UserResponse } from '@pitchpresence/shared';
import { api } from '@/lib/api';
import { dateLabel, monthLabel } from '@/lib/format';
import type { Roster } from '@/lib/types';
import { useResource, useCollection } from './data';
import type { Overview } from './team';
import { ActionLink, Button, Empty, Feedback, Field, Loading, PageTitle, Status } from './ui';
export function ManagementHome({ user }: { user: UserResponse }) {
  const overview = useResource<Overview>('/management/overview', 5000);
  const open = overview.data?.currentSession;
  return (
    <>
      <PageTitle
        eyebrow="MANAGEMENT / TEAM OVERVIEW"
        title={`The team comes first, ${user.name.split(' ')[0]}.`}
      >
        A clear view of training attendance, your players, and the month’s dues.
      </PageTitle>
      <Feedback error={overview.error} />
      {overview.loading ? (
        <Loading />
      ) : (
        overview.data && (
          <>
            <div className="split-grid">
              <section className="panel green-panel">
                <p className="eyebrow">TRAINING DAY</p>
                <h2>{open ? open.name : 'READY WHEN THE TEAM IS.'}</h2>
                <p>
                  {open
                    ? 'Attendance is open. Display the QR and follow arrivals.'
                    : 'Start a session at the pitch when your team is ready.'}
                </p>
                <ActionLink
                  href={open ? `/management/training/${open.id}` : '/management/training'}
                >
                  {open ? 'Open live session' : 'Manage training'}
                </ActionLink>
              </section>
              <section className="panel">
                <p className="eyebrow">{monthLabel(overview.data.dues.month)}</p>
                <h2>{overview.data.players.active} active players</h2>
                <p>
                  {overview.data.dues.paid} paid · {overview.data.dues.unpaid} not paid this month.
                </p>
                <ActionLink secondary href="/management/dues">
                  Manage dues
                </ActionLink>
              </section>
            </div>
            <section className="panel setup-checklist">
              <h2>Make the team your own.</h2>
              <p>Complete these whenever you’re ready. You can start training now.</p>
              <div className="record-row">
                <span>
                  {overview.data.setup.hasPlayers ? '✓ Players are joining' : 'Invite your players'}
                </span>
                <ActionLink secondary href="/management/players">
                  Players
                </ActionLink>
              </div>
              <div className="record-row">
                <span>
                  {overview.data.setup.duesConfigured
                    ? '✓ Monthly minimum set'
                    : 'Set this month’s dues'}
                </span>
                <ActionLink secondary href="/management/dues">
                  Dues
                </ActionLink>
              </div>
              <div className="record-row">
                <span>
                  {overview.data.setup.paymentsReady ? '✓ Bank connected' : 'Connect the team bank'}
                </span>
                <ActionLink secondary href="/management/team">
                  Team settings
                </ActionLink>
              </div>
            </section>
            <section className="panel">
              <h2>Recent training</h2>
              {overview.data.recentSessions.length ? (
                overview.data.recentSessions.map((s) => (
                  <Link
                    className="record-row linked-row"
                    key={s.id}
                    href={`/management/training/${s.id}`}
                  >
                    <div>
                      <strong>{s.name}</strong>
                      <small>{dateLabel(s.startedAt, true)}</small>
                    </div>
                    <Status value={s.status} />
                  </Link>
                ))
              ) : (
                <Empty>Your first session starts the history.</Empty>
              )}
            </section>
          </>
        )
      )}
      <div className="dashboard-links">
        <ActionLink secondary href="/management/team">
          Coaches & team bank
        </ActionLink>
        <ActionLink secondary href="/management/audit">
          Activity log
        </ActionLink>
      </div>
    </>
  );
}
export function Training() {
  const sessions = useCollection<TrainingResponse>('/training-sessions');
  const overview = useResource<Overview>('/management/overview');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const open = overview.data?.currentSession;
  async function reload() {
    await Promise.all([sessions.reload(), overview.reload()]);
  }
  async function start(event: FormEvent) {
    event.preventDefault();
    if (
      overview.data?.players.active === 0 &&
      !window.confirm(
        'There are no active players yet. Starting now creates an empty roster. New players will join the next session. Start anyway?',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      if (!navigator.geolocation)
        throw new Error(
          'Location is unavailable on this device. Use a supported browser at the pitch.',
        );
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 20000,
        }),
      );
      if (position.coords.accuracy > 100)
        throw new Error(
          `Location accuracy is ${Math.round(position.coords.accuracy)}m. Move to an open area and try again; 100m or better is required.`,
        );
      const session = await api<TrainingResponse>('/training-sessions', {
        method: 'POST',
        body: {
          name,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          locationAccuracy: position.coords.accuracy,
          locationCapturedAt: new Date(position.timestamp).toISOString(),
        },
      });
      location.assign(`/management/training/${session.id}`);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Location could not be captured. Allow location access and try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle eyebrow="MANAGEMENT / TRAINING" title="Every session starts here.">
        Open attendance at the pitch. Close the session when arrivals are finished.
      </PageTitle>
      <Feedback error={error ?? sessions.error ?? overview.error} />
      <div className="split-grid">
        <section className="panel">
          <h2>{open ? 'A session is already open.' : 'Start training'}</h2>
          {open ? (
            <ActionLink href={`/management/training/${open.id}`}>Open {open.name}</ActionLink>
          ) : (
            <form className="form-stack" onSubmit={start}>
              <Field
                label="Session name"
                placeholder="Saturday morning training"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
              />
              <div className="notice">
                <MapPin size={19} />
                <p>
                  Starting asks for a fresh, one-time location reading from your device. Players are
                  not tracked.
                </p>
              </div>
              <Button busy={busy} disabled={!overview.data} type="submit">
                Start session
              </Button>
            </form>
          )}
        </section>
        <section className="panel">
          <div className="between">
            <h2>Training sessions</h2>
            <Button variant="secondary" onClick={reload}>
              Refresh
            </Button>
          </div>
          {sessions.loading ? (
            <Loading />
          ) : !sessions.items.length ? (
            <Empty>No training sessions yet. Your first session starts the history.</Empty>
          ) : (
            sessions.items.map((s) => (
              <Link
                className="record-row linked-row"
                key={s.id}
                href={`/management/training/${s.id}`}
              >
                <div>
                  <strong>{s.name}</strong>
                  <small>{dateLabel(s.startedAt, true)}</small>
                </div>
                <Status value={s.status} />
              </Link>
            ))
          )}
          {sessions.nextCursor && (
            <Button variant="secondary" onClick={sessions.more} busy={sessions.busy}>
              Load more sessions
            </Button>
          )}
        </section>
      </div>
    </>
  );
}
export function TrainingSession({ id }: { id: string }) {
  const session = useResource<TrainingResponse>(`/training-sessions/${id}`, 5000);
  const roster = useResource<Roster>(`/training-sessions/${id}/attendance`, 5000);
  const [qr, setQr] = useState<{ image: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const [manual, setManual] = useState<{ id: string; name: string } | null>(null);
  const qrRef = useRef<HTMLDialogElement>(null);
  const isOpen = session.data?.status === 'OPEN' && roster.data?.status !== 'CLOSED';
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!isOpen) {
      setQr(null);
      return;
    }
    let cancelled = false;
    let fetching = false;
    const refresh = async () => {
      if (fetching || !navigator.onLine || document.hidden) return;
      fetching = true;
      try {
        const result = await api<{ token: string; expiresAt: string }>(
          `/training-sessions/${id}/qr-token`,
          { method: 'POST', body: {} },
        );
        const image = await QRCode.toDataURL(
          `${location.origin}/check-in#token=${encodeURIComponent(result.token)}`,
          {
            width: 720,
            margin: 4,
            errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#FFFFFF' },
          },
        );
        if (!cancelled) {
          setQr({ image, expiresAt: new Date(result.expiresAt).getTime() });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        fetching = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', visible);
    };
  }, [id, isOpen]);
  useEffect(() => {
    if (expanded) qrRef.current?.showModal();
    else qrRef.current?.close();
  }, [expanded]);
  async function close() {
    setBusy(true);
    try {
      await api(`/training-sessions/${id}/close`, { method: 'POST', body: {} });
      setQr(null);
      setClosing(false);
      await Promise.all([session.reload(), roster.reload()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mark() {
    if (!manual) return;
    setBusy(true);
    try {
      await api(`/training-sessions/${id}/attendance/manual`, {
        method: 'POST',
        body: { playerId: manual.id },
      });
      setManual(null);
      await roster.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const validQr = qr && qr.expiresAt > now && isOpen;
  const code = validQr ? (
    <img
      className="live-qr"
      src={qr.image}
      alt="Live training check-in QR code"
      width={360}
      height={360}
    />
  ) : (
    <div className="qr-placeholder">
      <ScanLine size={54} />
      <p>{isOpen ? 'Waiting for a fresh code. Reconnect if needed.' : 'Attendance is closed.'}</p>
    </div>
  );
  return (
    <>
      <PageTitle
        eyebrow="MANAGEMENT / LIVE TRAINING"
        title={session.data?.name ?? 'Training session'}
      >
        {session.data ? dateLabel(session.data.startedAt, true) : 'Opening the session…'}
      </PageTitle>
      <Feedback error={error ?? session.error ?? roster.error} />
      {session.loading ? (
        <Loading />
      ) : (
        <div className="training-grid">
          <section className="panel qr-panel">
            <div className="between">
              <h2>Check in here.</h2>
              {session.data && <Status value={session.data.status} />}
            </div>
            {code}
            <p>Players: scan with your phone’s camera, then confirm your arrival.</p>
            {validQr && (
              <p className="helper">
                Code expires in {Math.max(0, Math.ceil((qr.expiresAt - now) / 1000))}s · refreshes
                automatically
              </p>
            )}
            {isOpen && (
              <Button variant="secondary" onClick={() => setExpanded(true)}>
                <Maximize2 size={17} />
                Expand QR
              </Button>
            )}
            <div className="qr-note">
              Codes rotate to reduce old screenshot reuse. Scanning does not verify a player’s
              location.
            </div>
            {isOpen && (
              <Button variant="danger" onClick={() => setClosing(true)}>
                Close attendance
              </Button>
            )}
          </section>
          <section className="panel">
            <div className="between">
              <div>
                <h2>Team arrivals</h2>
                <p className="muted">
                  {roster.data
                    ? `${roster.data.checkedInCount} of ${roster.data.players.length} recorded`
                    : 'Loading roster…'}
                </p>
              </div>
              <Button variant="secondary" onClick={roster.reload}>
                Refresh
              </Button>
            </div>
            {roster.loading ? (
              <Loading />
            ) : !roster.data?.players.length ? (
              <Empty>
                No eligible players in this session’s roster. Newly activated players join the next
                session.
              </Empty>
            ) : (
              roster.data.players.map((player) => (
                <div className="roster-row" key={player.playerId}>
                  <span className="avatar">{player.name[0]}</span>
                  <div>
                    <strong>{player.name}</strong>
                    <small>
                      {player.attendance
                        ? `${dateLabel(player.attendance.checkedInAt, true)} · ${player.attendance.method}`
                        : 'Eligible for this session'}
                    </small>
                  </div>
                  {player.attendance ? (
                    <Check size={20} />
                  ) : isOpen ? (
                    <Button
                      variant="secondary"
                      onClick={() => setManual({ id: player.playerId, name: player.name })}
                    >
                      Mark present
                    </Button>
                  ) : (
                    <Status value={player.result} />
                  )}
                </div>
              ))
            )}
            <p className="helper">
              Updates every 5 seconds while this page is visible. Last successful records remain
              visible if reconnecting.
            </p>
          </section>
        </div>
      )}
      <dialog
        ref={qrRef}
        className="qr-dialog"
        aria-label="Expanded training QR code"
        onCancel={() => setExpanded(false)}
      >
        <Button variant="secondary" onClick={() => setExpanded(false)}>
          Close expanded view
        </Button>
        <h2>{session.data?.name}</h2>
        {code}
        <p>Scan. Confirm. Get back to football.</p>
      </dialog>
      {closing && (
        <Confirmation
          error={error}
          title="Close attendance?"
          busy={busy}
          onCancel={() => setClosing(false)}
          onConfirm={close}
          action="Close attendance"
        >
          Players without a recorded arrival will be marked absent. New QR and manual check-ins will
          stop for this session.
        </Confirmation>
      )}
      {manual && (
        <Confirmation
          error={error}
          title={`Mark ${manual.name} present?`}
          busy={busy}
          onCancel={() => setManual(null)}
          onConfirm={mark}
          action="Confirm attendance"
        >
          This records the current time and your manager account as the person confirming
          attendance.
        </Confirmation>
      )}
    </>
  );
}
export function Confirmation({
  title,
  error,
  children,
  action,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  children: React.ReactNode;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p>{children}</p>
      <Feedback error={error} />
      <div className="actions">
        <Button busy={busy} onClick={onConfirm}>
          {action}
        </Button>
        <Button disabled={busy} variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}
