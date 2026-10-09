'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCheck, ScanLine, Wallet, ArrowUpRight } from 'lucide-react';
import type { AttendanceResponse, PaymentResponse, UserResponse } from '@pitchpresence/shared';
import { api } from '@/lib/api';
import { dateLabel, money, monthLabel, parseMoney } from '@/lib/format';
import type { AttendanceRecord, DuesRecord } from '@/lib/types';
import { ReceiptUpload, ReceiptDownload } from './manual-payments';
import { AuthForm, type AuthSession } from './auth';
import { useCollection, useResource } from './data';
import { ActionLink, Button, Empty, Feedback, Field, Loading, Logo, PageTitle, Status } from './ui';
export function PlayerHome({ user }: { user: UserResponse }) {
  const dues = useCollection<DuesRecord>('/me/dues?limit=1');
  return (
    <>
      <PageTitle
        eyebrow="YOUR TEAM, TOGETHER"
        title={`Good to see you, ${user.name.split(' ')[0]}.`}
      >
        Show up for training. Keep your months in order.
      </PageTitle>
      <div className="split-grid">
        <section className="panel green-panel">
          <p className="eyebrow">YOUR NEXT TRAINING</p>
          <ScanLine size={42} />
          <h2>
            SHOW UP.
            <br />
            SCAN IN.
            <br />
            GET PLAYING.
          </h2>
          <p>
            At the pitch, open your phone’s camera and scan management’s QR code. Your arrival is
            recorded after confirmation.
          </p>
          <Link className="button light" href="/attendance">
            View attendance
            <ArrowUpRight size={18} />
          </Link>
        </section>
        <section className="panel">
          <p className="eyebrow">THIS MONTH’S DUES</p>
          <Wallet size={30} />
          {dues.loading ? (
            <Loading />
          ) : dues.data?.items[0] ? (
            <>
              <h2>{monthLabel(dues.data.items[0].month)}</h2>
              <Status
                value={
                  dues.data.items[0].status === 'NOT_PAID' &&
                  dues.data.items[0].payments.some((p) => p.receipt?.status === 'PENDING')
                    ? 'PROOF_SUBMITTED'
                    : dues.data.items[0].status
                }
              />
              <p>
                {dues.data.items[0].minimumAmount
                  ? `Monthly minimum: ${money(dues.data.items[0].minimumAmount)}`
                  : 'Management has not configured this month’s minimum yet.'}
              </p>
              <ActionLink href="/dues" secondary>
                View your months
              </ActionLink>
            </>
          ) : (
            <Empty>Your monthly history will appear here once your account is active.</Empty>
          )}
          <Feedback error={dues.error} />
        </section>
      </div>
      <div className="small-note">
        <CheckCheck size={22} />
        <div>
          <strong>A record you can rely on.</strong>
          <p>Attendance times and payment status are confirmed by the team’s records.</p>
        </div>
      </div>
    </>
  );
}
export function Attendance() {
  const records = useCollection<AttendanceRecord>('/me/attendance');
  return (
    <>
      <PageTitle eyebrow="TRAINING / YOUR HISTORY" title="Every arrival, recorded.">
        Session dates and check-in times use Lagos time. Open sessions remain “Not checked in” until
        attendance closes.
      </PageTitle>
      <section className="panel">
        <div className="between">
          <h2>Training records</h2>
          <Button variant="secondary" onClick={records.reload}>
            Refresh
          </Button>
        </div>
        <Feedback error={records.error} />
        {records.loading ? (
          <Loading />
        ) : !records.items.length ? (
          <Empty>No training records yet. Scan the code at your next session to get started.</Empty>
        ) : (
          records.items.map((row) => (
            <article className="record-row" key={row.id}>
              <span className="record-icon">
                <ScanLine size={22} />
              </span>
              <div>
                <strong>{row.session.name}</strong>
                <small>
                  {dateLabel(row.session.date)}
                  {row.attendance &&
                    ` · ${dateLabel(row.attendance.checkedInAt, true)} · ${row.attendance.method === 'QR' ? 'QR check-in' : 'Recorded by management'}`}
                </small>
              </div>
              <Status value={row.result} />
            </article>
          ))
        )}
        {records.nextCursor && (
          <Button busy={records.busy} variant="secondary" onClick={records.more}>
            Load more records
          </Button>
        )}
        <p className="helper">
          Records follow the API’s record order. Dates are shown on every entry.
        </p>
      </section>
    </>
  );
}
export function CheckIn({
  user,
  loading,
  error: authError,
  authenticated,
}: {
  user: UserResponse | null;
  loading: boolean;
  error: string | null;
  authenticated: (session: AuthSession) => void;
}) {
  const token = useRef<string | null>(null);
  const [captured, setCaptured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    attendance: AttendanceResponse;
    alreadyRecorded: boolean;
  } | null>(null);
  const tokenCaptured = useRef(false);
  useEffect(() => {
    if (tokenCaptured.current) return;
    tokenCaptured.current = true;
    token.current = new URLSearchParams(location.hash.slice(1)).get('token');
    history.replaceState(null, '', '/check-in');
    setCaptured(true);
  }, []);
  async function checkIn() {
    if (!token.current) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api('/attendance/check-in', { method: 'POST', body: { token: token.current } }),
      );
      token.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="check-in-page">
      <Logo />
      <div className="check-in-card">
        <p className="eyebrow">TRAINING / YOUR ARRIVAL</p>
        {loading || !captured ? (
          <Loading />
        ) : result ? (
          <>
            <span className="big-check">
              <CheckCheck size={40} />
            </span>
            <h1>{result.alreadyRecorded ? 'Already checked in.' : 'You’re checked in.'}</h1>
            <p>Your arrival was recorded at {dateLabel(result.attendance.checkedInAt, true)}.</p>
            <ActionLink href="/attendance">View attendance</ActionLink>
          </>
        ) : !token.current ? (
          <>
            <ScanLine size={42} />
            <h1>A fresh scan gets you in.</h1>
            <p>
              Use your camera to scan the QR code currently displayed by management at the pitch.
            </p>
            <ActionLink href="/home" secondary>
              Back to your team
            </ActionLink>
          </>
        ) : !user ? (
          <>
            <p>
              Sign in here to confirm your check-in. The training code stays on this page and may
              expire while you sign in.
            </p>
            <Feedback error={authError} />
            <AuthForm mode="player/sign-in" onAuthenticated={authenticated} />
          </>
        ) : user.role !== 'PLAYER' ? (
          <>
            <h1>Player check-in only.</h1>
            <ActionLink href="/management">Open management</ActionLink>
          </>
        ) : (
          <>
            <ScanLine size={48} />
            <h1>Ready, {user.name.split(' ')[0]}?</h1>
            <p>Confirm your arrival while this code is still valid.</p>
            <Button busy={busy} onClick={checkIn}>
              Confirm check-in
            </Button>
            <Feedback error={error} />
            {error && (
              <p>
                Expired or closed? Ask management for a fresh code or help recording your
                attendance.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
export function PlayerDues({ user }: { user: UserResponse }) {
  const records = useCollection<DuesRecord>('/me/dues');
  const [selected, setSelected] = useState<DuesRecord | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PaymentResponse | null>(null);
  async function pay(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const kobo = parseMoney(amount);
      if (kobo < (selected.minimumAmount ?? 0))
        throw new Error('The amount must meet the monthly minimum.');
      const storageKey = `payment-attempt:${user.id}:${selected.month}`;
      const old = sessionStorage.getItem(storageKey);
      const stored = old ? (JSON.parse(old) as { key: string; amount: number }) : null;
      if (stored && stored.amount !== kobo)
        throw new Error(
          'A previous checkout may still be pending. Check its status before changing the amount.',
        );
      const key = stored?.key ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, JSON.stringify({ key, amount: kobo }));
      const payment = await api<PaymentResponse>('/payments/paystack/initialize', {
        method: 'POST',
        body: { month: selected.month, amount: kobo },
        key,
      });
      setPending(payment);
      if (payment.status === 'SUCCESS') {
        sessionStorage.removeItem(storageKey);
        await records.reload();
      } else if (payment.status === 'FAILED') {
        sessionStorage.removeItem(storageKey);
        setError('This payment attempt failed. Review the amount and try again.');
      } else if (payment.checkoutUrl) location.assign(payment.checkoutUrl);
      else
        setError('Your checkout is pending. Do not start another payment. Check its status below.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    if (!pending) return;
    setBusy(true);
    try {
      const p = await api<PaymentResponse>(`/payments/${pending.id}/verify`, {
        method: 'POST',
        body: {},
      });
      setPending(p);
      if (p.status !== 'PENDING' && selected)
        sessionStorage.removeItem(`payment-attempt:${user.id}:${selected.month}`);
      await records.reload();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle eyebrow="DUES / YOUR MONTHS" title="A month sorted. One less thing.">
        Transfer to your team’s bank account and submit your receipt, or ask staff to record a
        payment. Your month is paid after staff confirmation.
      </PageTitle>
      <div className="split-grid">
        <section className="panel">
          <div className="between">
            <h2>Monthly history</h2>
            <Button variant="secondary" onClick={records.reload}>
              Refresh
            </Button>
          </div>
          <Feedback error={records.error} />
          {records.loading ? (
            <Loading />
          ) : !records.items.length ? (
            <Empty>Your monthly dues will appear here.</Empty>
          ) : (
            records.items.map((row) => (
              <button
                className={`dues-select ${selected?.id === row.id ? 'selected' : ''}`}
                key={row.id}
                onClick={() => {
                  setSelected(row);
                  setAmount(String((row.minimumAmount ?? 0) / 100));
                  setPending(null);
                  setError(null);
                }}
              >
                <div>
                  <strong>{monthLabel(row.month)}</strong>
                  <small>
                    {row.minimumAmount
                      ? `Minimum ${money(row.minimumAmount)}`
                      : 'Minimum not configured'}
                  </small>
                </div>
                <Status
                  value={
                    row.status === 'NOT_PAID' &&
                    row.payments.some((p) => p.receipt?.status === 'PENDING')
                      ? 'PROOF_SUBMITTED'
                      : row.status
                  }
                />
              </button>
            ))
          )}
          {records.nextCursor && (
            <Button variant="secondary" busy={records.busy} onClick={records.more}>
              Load more months
            </Button>
          )}
        </section>
        <section className="panel payment-panel">
          <Wallet size={32} />
          {!selected ? (
            <>
              <h2>Your payments, in one place.</h2>
              <p>Select a month to view its payment history or continue to checkout.</p>
            </>
          ) : (
            <>
              <h2>{monthLabel(selected.month)}</h2>
              <Status
                value={records.items.find((r) => r.id === selected.id)?.status ?? selected.status}
              />
              <Feedback error={error} />
              <ReceiptUpload
                key={selected.id}
                dues={records.items.find((r) => r.id === selected.id) ?? selected}
                reload={records.reload}
              />
              {selected.paymentMode === 'PAYSTACK' &&
                (records.items.find((r) => r.id === selected.id)?.status ?? selected.status) ===
                  'NOT_PAID' && (
                  <form className="form-stack" onSubmit={pay}>
                    <Field
                      label="Checkout amount in naira"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      help={
                        selected.minimumAmount
                          ? `Minimum ${money(selected.minimumAmount)}`
                          : 'Management must configure this month before checkout.'
                      }
                      required
                    />
                    <Button
                      busy={busy}
                      disabled={
                        !selected.paymentAvailable || (!!pending && pending.status !== 'FAILED')
                      }
                      type="submit"
                    >
                      Continue to Paystack
                      <ArrowUpRight size={17} />
                    </Button>
                    {selected.paymentsReady === false && (
                      <p className="helper">
                        Online payments are waiting for your team’s bank setup. Contact your coach
                        or manager.
                      </p>
                    )}
                    <small>Payment is confirmed by the server after Paystack verification.</small>
                  </form>
                )}
              {pending && (
                <div className="notice">
                  <Status value={pending.status} />
                  <Button variant="secondary" busy={busy} onClick={verify}>
                    Check payment status
                  </Button>
                </div>
              )}
              <h3>Payment history</h3>
              {(records.items.find((r) => r.id === selected.id)?.payments ?? selected.payments)
                .length ? (
                (
                  records.items.find((r) => r.id === selected.id)?.payments ?? selected.payments
                ).map((p) => (
                  <div className="record-row" key={p.id}>
                    <div>
                      <strong>{money(p.amount)}</strong>
                      <small>
                        {p.provider === 'EXTERNAL'
                          ? p.receipt
                            ? 'Bank transfer · receipt proof'
                            : 'External · management confirmation'
                          : 'Paystack'}
                        {p.reversedAt ? ' · reversed' : ''}
                      </small>
                    </div>
                    <div>
                      <Status
                        value={
                          p.reversedAt
                            ? 'REVERSED'
                            : p.receipt?.status === 'PENDING'
                              ? 'PROOF_SUBMITTED'
                              : p.status
                        }
                      />
                      {p.receipt && (
                        <>
                          <ReceiptDownload receipt={p.receipt} />
                          {p.receipt.reason && (
                            <p className="helper">Staff note: {p.receipt.reason}</p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted">No payments recorded for this month.</p>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
export function PaymentReturn() {
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<PaymentResponse | null>(null);
  useEffect(() => {
    setId(new URLSearchParams(location.search).get('paymentId'));
  }, []);
  const resource = useResource<PaymentResponse>(id ? `/payments/${id}` : null, id ? 5000 : 0);
  async function verify() {
    if (!id) return;
    setBusy(true);
    try {
      setPayment(
        await api<PaymentResponse>(`/payments/${id}/verify`, { method: 'POST', body: {} }),
      );
      setError(null);
      await resource.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const status = resource.data ?? payment;
  return (
    <>
      <PageTitle
        eyebrow="DUES / PAYMENT CONFIRMATION"
        title={status?.status === 'SUCCESS' ? 'Payment confirmed.' : 'Let’s check your payment.'}
      >
        Returning from checkout does not confirm payment. We use the server’s verified payment
        status.
      </PageTitle>
      <section className="panel">
        <Feedback error={error ?? resource.error} />
        {status && (
          <>
            <Status value={status.status} />
            <h2>{money(status.amount)}</h2>
            <p>
              {status.status === 'PENDING'
                ? 'Your payment is still pending. Keep this page open or check again. Avoid paying twice.'
                : status.status === 'SUCCESS'
                  ? 'Your monthly record has been updated.'
                  : 'This attempt failed. Review your dues before trying again.'}
            </p>
          </>
        )}
        {id ? (
          <Button busy={busy} onClick={verify}>
            Check payment status
          </Button>
        ) : (
          <p>No payment reference was provided.</p>
        )}
        <ActionLink secondary href="/dues">
          Back to dues
        </ActionLink>
      </section>
    </>
  );
}
