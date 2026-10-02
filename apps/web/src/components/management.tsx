'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Clipboard, Link2, ShieldCheck, Users } from 'lucide-react';
import type { UserResponse } from '@pitchpresence/shared';
import { api, RequestError, setCsrfToken } from '@/lib/api';
import { currentMonth, dateLabel, money, monthLabel, parseMoney } from '@/lib/format';
import type { DuesRecord, PaymentRecord } from '@/lib/types';
import { useCollection, useResource } from './data';
import { Confirmation } from './training';
import { Button, Empty, Feedback, Field, Loading, PageTitle, Status } from './ui';
type Invitation = { id: string; expiresAt: string; revokedAt: string | null; createdAt: string };
export function Players() {
  const players = useCollection<UserResponse>('/management/players');
  const invitations = useCollection<Invitation>('/management/invitations');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<UserResponse | null>(null);
  const [name, setName] = useState('');
  const [toggle, setToggle] = useState<UserResponse | null>(null);
  const [invite, setInvite] = useState<{ registrationUrl: string; expiresAt: string } | null>(null);
  const [revoke, setRevoke] = useState<string | null>(null);
  async function createInvite() {
    setBusy(true);
    setError(null);
    try {
      setInvite(await api('/management/invitations', { method: 'POST', body: {} }));
      await invitations.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.registrationUrl);
      setMessage('Invitation copied. Share it with your players.');
    } catch {
      setError('Copy is unavailable. Select and copy the invitation link below.');
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      await api(`/management/players/${editing.id}`, { method: 'PATCH', body: { name } });
      setEditing(null);
      await players.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeActive() {
    if (!toggle) return;
    setBusy(true);
    try {
      await api(`/management/players/${toggle.id}`, {
        method: 'PATCH',
        body: { active: !toggle.active },
      });
      setToggle(null);
      await players.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revokeInvite() {
    if (!revoke) return;
    setBusy(true);
    try {
      await api(`/management/invitations/${revoke}`, { method: 'DELETE' });
      setRevoke(null);
      await invitations.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle eyebrow="MANAGEMENT / PLAYERS" title="The people behind the game.">
        Invite your players, keep their details up to date, and manage account access.
      </PageTitle>
      <Feedback error={error} success={message} />
      <div className="split-grid players-grid">
        <section className="panel">
          <div className="between">
            <h2>
              <Users size={22} />
              Team players
            </h2>
            <Button variant="secondary" onClick={players.reload}>
              Refresh
            </Button>
          </div>
          <Field
            label="Search loaded players"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            help="Search covers the players loaded below. Load more to include additional players."
          />
          <Feedback error={players.error} />
          {players.loading ? (
            <Loading />
          ) : !players.items.length ? (
            <Empty>Your players will appear here after joining through an invitation.</Empty>
          ) : (
            players.items
              .filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(search.toLowerCase()))
              .map((player) => (
                <div className="player-row" key={player.id}>
                  <span className="avatar">{player.name[0]}</span>
                  <div className="player-info">
                    <strong>{player.name}</strong>
                    <small>{player.email}</small>
                    <Status
                      value={
                        !player.isVerified ? 'UNVERIFIED' : player.active ? 'ACTIVE' : 'INACTIVE'
                      }
                    />
                  </div>
                  <div className="row-actions">
                    <button
                      className="text-action"
                      onClick={() => {
                        setEditing(player);
                        setName(player.name);
                      }}
                    >
                      Edit name
                    </button>
                    <button
                      className="text-action"
                      disabled={!player.isVerified}
                      onClick={() => setToggle(player)}
                    >
                      {player.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))
          )}
          {players.nextCursor && (
            <Button variant="secondary" busy={players.busy} onClick={players.more}>
              Load more players
            </Button>
          )}
        </section>
        <section className="panel">
          <Link2 size={30} />
          <h2>A place on the team.</h2>
          <p>
            Create a reusable player invitation. The link expires in seven days and can be revoked.
          </p>
          <Button busy={busy} onClick={createInvite}>
            Create invitation
          </Button>
          {invite && (
            <div className="invite-result">
              <Field
                label="New invitation link"
                value={invite.registrationUrl}
                readOnly
                help={`Expires ${dateLabel(invite.expiresAt, true)}. Copy now; the link cannot be recovered later.`}
              />
              <Button variant="secondary" onClick={copy}>
                <Clipboard size={16} />
                Copy link
              </Button>
            </div>
          )}
          <h3>Invitation history</h3>
          <Feedback error={invitations.error} />
          {invitations.loading ? (
            <Loading />
          ) : (
            invitations.items.map((i) => (
              <div className="record-row" key={i.id}>
                <div>
                  <strong>
                    {i.revokedAt
                      ? 'Revoked'
                      : new Date(i.expiresAt).getTime() < Date.now()
                        ? 'Expired'
                        : 'Active invitation'}
                  </strong>
                  <small>Expires {dateLabel(i.expiresAt, true)}</small>
                </div>
                {!i.revokedAt && new Date(i.expiresAt).getTime() > Date.now() && (
                  <Button variant="secondary" onClick={() => setRevoke(i.id)}>
                    Revoke
                  </Button>
                )}
              </div>
            ))
          )}
          {invitations.nextCursor && (
            <Button variant="secondary" busy={invitations.busy} onClick={invitations.more}>
              Load more invitations
            </Button>
          )}
        </section>
      </div>
      {editing && (
        <FormDialog title="Update player name" onClose={() => setEditing(null)} busy={busy}>
          <form onSubmit={save} className="form-stack">
            <Field
              label="Player name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
            <Feedback error={error} />
            <Button busy={busy} type="submit">
              Save name
            </Button>
          </form>
        </FormDialog>
      )}
      {toggle && (
        <Confirmation
          error={error}
          title={`${toggle.active ? 'Deactivate' : 'Activate'} ${toggle.name}?`}
          busy={busy}
          onCancel={() => setToggle(null)}
          onConfirm={changeActive}
          action={toggle.active ? 'Deactivate player' : 'Activate player'}
        >
          {toggle.active
            ? 'Their devices will be signed out, and new attendance and payment activity will be blocked. Existing records remain available to management.'
            : 'The verified player can sign in again and participate in future sessions.'}
        </Confirmation>
      )}
      {revoke && (
        <Confirmation
          error={error}
          title="Revoke this invitation?"
          busy={busy}
          onCancel={() => setRevoke(null)}
          onConfirm={revokeInvite}
          action="Revoke invitation"
        >
          Players can no longer register using this link. Existing player accounts are kept.
        </Confirmation>
      )}
    </>
  );
}
type Period = { month: string; minimumAmount: number; frozenAt: string | null };
export function ManagementDues() {
  const [month, setMonth] = useState(currentMonth());
  const [filter, setFilter] = useState('');
  const records = useCollection<DuesRecord>(
    `/management/dues?month=${month}${filter ? `&status=${filter}` : ''}`,
  );
  const periods = useCollection<Period>('/management/dues-periods?limit=100');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [manual, setManual] = useState<DuesRecord | null>(null);
  const [manualAmount, setManualAmount] = useState('');
  const [reference, setReference] = useState('');
  const [reversing, setReversing] = useState<{ dues: DuesRecord; payment: PaymentRecord } | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const period = periods.items.find((p) => p.month === month);
  useEffect(() => {
    setAmount(period ? String(period.minimumAmount / 100) : '');
  }, [period, month]);
  async function configure(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/management/dues-periods/${month}`, {
        method: 'PUT',
        body: { minimumAmount: parseMoney(amount) },
      });
      await periods.reload();
      setMessage('Monthly minimum saved.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mark(event: FormEvent) {
    event.preventDefault();
    if (!manual) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/dues/${manual.id}/mark-paid`, {
        method: 'POST',
        body: {
          amount: parseMoney(manualAmount),
          ...(reference ? { externalReference: reference } : {}),
        },
      });
      setManual(null);
      await Promise.all([records.reload(), periods.reload()]);
      setMessage('External payment recorded.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reverse(event: FormEvent) {
    event.preventDefault();
    if (!reversing) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/dues/${reversing.dues.id}/reverse-manual-payment`, {
        method: 'POST',
        body: { paymentId: reversing.payment.id, reason },
      });
      setReversing(null);
      await records.reload();
      setMessage('Manual payment reversed. The month’s status has been recalculated.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle eyebrow="MANAGEMENT / MONTHLY DUES" title="Keep the months in order.">
        Set the monthly minimum and confirm payments made outside the app.
      </PageTitle>
      <Feedback error={error} success={message} />
      <div className="split-grid">
        <section className="panel">
          <div className="between">
            <h2>Player dues</h2>
            <Button variant="secondary" onClick={records.reload}>
              Refresh
            </Button>
          </div>
          <div className="filter-row">
            <Field
              label="Month"
              type="month"
              value={month}
              max={currentMonth()}
              min="2000-01"
              onChange={(e) => {
                if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value);
              }}
            />
            <label className="field">
              <span>Status</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="PAID">Paid</option>
                <option value="NOT_PAID">Not paid</option>
              </select>
            </label>
          </div>
          <Feedback error={records.error} />
          {records.loading ? (
            <Loading />
          ) : !records.items.length ? (
            <Empty>No eligible player records for this month and status.</Empty>
          ) : (
            records.items.map((row) => (
              <article className="management-dues-row" key={row.id}>
                <div className="between">
                  <div>
                    <strong>{row.player?.name ?? 'Player'}</strong>
                    <small>{monthLabel(row.month)}</small>
                  </div>
                  <Status value={row.status} />
                </div>
                {row.status === 'NOT_PAID' && (
                  <Button
                    variant="secondary"
                    disabled={!period}
                    onClick={() => {
                      setManual(row);
                      setManualAmount(period ? String(period.minimumAmount / 100) : '');
                      setReference('');
                      setError(null);
                    }}
                  >
                    Confirm external payment
                  </Button>
                )}
                {row.payments.map((p) => (
                  <div className="payment-line" key={p.id}>
                    <span>
                      {money(p.amount)} ·{' '}
                      {p.provider === 'EXTERNAL' ? 'External payment' : 'Paystack'} ·{' '}
                      {p.reversedAt ? 'Reversed' : p.status.toLowerCase()}
                    </span>
                    {p.provider === 'EXTERNAL' && p.status === 'SUCCESS' && !p.reversedAt && (
                      <button
                        className="text-action"
                        onClick={() => {
                          setReversing({ dues: row, payment: p });
                          setReason('');
                          setError(null);
                        }}
                      >
                        Reverse
                      </button>
                    )}
                  </div>
                ))}
              </article>
            ))
          )}
          {records.nextCursor && (
            <Button variant="secondary" busy={records.busy} onClick={records.more}>
              Load more records
            </Button>
          )}
        </section>
        <section className="panel">
          <p className="eyebrow">MONTH SETTINGS</p>
          <h2>{monthLabel(month)}</h2>
          <Feedback error={periods.error} />
          <form className="form-stack" onSubmit={configure}>
            <Field
              label="Minimum amount in naira"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              readOnly={!!period?.frozenAt}
              required
            />
            {period?.frozenAt ? (
              <div className="notice">
                This minimum is fixed because payment activity has started.
              </div>
            ) : (
              <p className="helper">
                The minimum becomes fixed once checkout or external payment activity begins.
              </p>
            )}
            <Button busy={busy} disabled={!!period?.frozenAt || periods.loading} type="submit">
              Save monthly minimum
            </Button>
          </form>
          {periods.nextCursor && (
            <Button variant="secondary" onClick={periods.more} busy={periods.busy}>
              Load older month settings
            </Button>
          )}
          <div className="small-note">
            <ShieldCheck size={22} />
            <p>
              Manual confirmation records your manager account. Reversals require a reason. Paystack
              payments cannot be reversed here.
            </p>
          </div>
        </section>
      </div>
      {manual && (
        <FormDialog
          title={`Confirm payment for ${manual.player?.name}?`}
          onClose={() => setManual(null)}
          busy={busy}
        >
          <p>Only confirm money the team has received for {monthLabel(manual.month)}.</p>
          <form onSubmit={mark} className="form-stack">
            <Field
              label="Amount received in naira"
              inputMode="decimal"
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)}
              required
              help={period ? `Minimum ${money(period.minimumAmount)}` : undefined}
            />
            <Field
              label="External reference (optional)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={200}
            />
            <Feedback error={error} />
            <Button busy={busy} type="submit">
              Confirm received payment
            </Button>
          </form>
        </FormDialog>
      )}
      {reversing && (
        <FormDialog title="Reverse manual payment?" onClose={() => setReversing(null)} busy={busy}>
          <p>
            Reverse {money(reversing.payment.amount)} for {reversing.dues.player?.name}. Another
            qualifying payment can keep this month paid.
          </p>
          <form onSubmit={reverse} className="form-stack">
            <Field
              label="Reason for reversal"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              maxLength={500}
              required
            />
            <Feedback error={error} />
            <Button busy={busy} type="submit">
              Reverse manual payment
            </Button>
          </form>
        </FormDialog>
      )}
    </>
  );
}
type AuditEvent = {
  id: string;
  action: string;
  actorId: string | null;
  entityId: string;
  createdAt: string;
  changes: unknown;
  reason: string | null;
};
export function Audit() {
  const records = useCollection<AuditEvent>('/management/audit-events');
  return (
    <>
      <PageTitle eyebrow="MANAGEMENT / ACTIVITY LOG" title="A clear trail of changes.">
        Review recorded management actions. Actor identifiers refer to the account that performed
        the action.
      </PageTitle>
      <section className="panel">
        <Button variant="secondary" onClick={records.reload}>
          Refresh activity
        </Button>
        <Feedback error={records.error} />
        {records.loading ? (
          <Loading />
        ) : !records.items.length ? (
          <Empty>No actions recorded yet.</Empty>
        ) : (
          records.items.map((row) => (
            <details className="audit-row" key={row.id}>
              <summary>
                <strong>{row.action.replace(/_/g, ' ').toLowerCase()}</strong>
                <span>{dateLabel(row.createdAt, true)}</span>
              </summary>
              <dl>
                <dt>Actor account</dt>
                <dd>{row.actorId ?? 'System'}</dd>
                <dt>Record</dt>
                <dd>{row.entityId}</dd>
              </dl>
              <pre>{JSON.stringify({ reason: row.reason, changes: row.changes }, null, 2)}</pre>
            </details>
          ))
        )}
        {records.nextCursor && (
          <Button variant="secondary" onClick={records.more} busy={records.busy}>
            Load more activity
          </Button>
        )}
      </section>
    </>
  );
}
type Device = { id: string; createdAt: string; lastUsedAt: string; expiresAt: string };
export function Account({ user }: { user: UserResponse }) {
  const devices = useCollection<Device>('/auth/sessions');
  const [revoke, setRevoke] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operations = useResource<{
    pendingPayments: number;
    paymentsRequiringReview: number;
    failedJobs: number;
  }>(user.role === 'MANAGER' ? '/management/operations' : null);
  async function remove() {
    if (!revoke) return;
    setBusy(true);
    try {
      await api(`/auth/sessions/${revoke}`, { method: 'DELETE' });
      setRevoke(null);
      try {
        await api('/auth/me');
      } catch (error) {
        if (error instanceof RequestError && error.status === 401) {
          window.dispatchEvent(new Event('session-expired'));
          return;
        }
        throw error;
      }
      await devices.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
      setCsrfToken(null);
      location.assign(user.role === 'MANAGER' ? '/sign-in' : '/player/sign-in');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle eyebrow="YOUR ACCOUNT / ACCESS" title="Your place on the team.">
        Manage your account details and signed-in devices.
      </PageTitle>
      <Feedback error={error} />
      <div className="split-grid">
        <section className="panel">
          <ShieldCheck size={30} />
          <h2>{user.name}</h2>
          <p>{user.email}</p>
          <Status value={user.active ? 'ACTIVE' : 'INACTIVE'} />
          <p>{user.role === 'MANAGER' ? 'Team manager' : 'Team player'}</p>
          <Link
            className="button secondary"
            href={user.role === 'MANAGER' ? '/forgot-password' : '/reset-pin'}
          >
            Reset {user.role === 'MANAGER' ? 'password' : 'PIN'}
          </Link>
          <p className="helper">
            Resetting your {user.role === 'MANAGER' ? 'password' : 'PIN'} signs out all devices
            after confirmation.
          </p>
          <div className="actions">
            <Button busy={busy} variant="secondary" onClick={signOut}>
              Sign out of this device
            </Button>
            {user.role === 'MANAGER' && (
              <Link className="button secondary" href="/management/audit">
                Activity log
              </Link>
            )}
          </div>
          <Feedback error={operations.error} />
          {user.role === 'MANAGER' && operations.data && (
            <>
              <h3>Operations</h3>
              <dl>
                {Object.entries({
                  'Pending payments': operations.data.pendingPayments,
                  'Payments requiring review': operations.data.paymentsRequiringReview,
                  'Failed jobs': operations.data.failedJobs,
                }).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replace(/([A-Z])/g, ' $1')}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </section>
        <section className="panel">
          <div className="between">
            <h2>Signed-in devices</h2>
            <Button variant="secondary" onClick={devices.reload}>
              Refresh
            </Button>
          </div>
          <Feedback error={devices.error} />
          {devices.loading ? (
            <Loading />
          ) : (
            devices.items.map((d) => (
              <div className="record-row" key={d.id}>
                <div>
                  <strong>Signed in {dateLabel(d.createdAt)}</strong>
                  <small>Last active {dateLabel(d.lastUsedAt, true)}</small>
                </div>
                <Button variant="secondary" onClick={() => setRevoke(d.id)}>
                  Sign out
                </Button>
              </div>
            ))
          )}
          {devices.nextCursor && (
            <Button variant="secondary" onClick={devices.more} busy={devices.busy}>
              Load more devices
            </Button>
          )}
          <p className="helper">
            Device labels aren’t available yet. Use sign-in and last-active dates to identify a
            session.
          </p>
        </section>
      </div>
      {revoke && (
        <Confirmation
          error={error}
          title="Sign out this device?"
          onCancel={() => setRevoke(null)}
          onConfirm={remove}
          busy={busy}
          action="Sign out device"
        >
          This ends the selected device’s session. If it’s your current device, you’ll need to sign
          in again.
        </Confirmation>
      )}
    </>
  );
}
function FormDialog({
  title,
  children,
  onClose,
  busy,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy: boolean;
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
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="between">
        <h2 id={titleId}>{title}</h2>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </div>
      {children}
    </dialog>
  );
}
