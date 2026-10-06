'use client';
import { useState, type FormEvent } from 'react';
import type { OverviewResponse, TeamSettingsResponse, UserResponse } from '@pitchpresence/shared';
import { api } from '@/lib/api';
import { dateLabel } from '@/lib/format';
import { Button, Feedback, Field, PageTitle, ActionLink, Loading, Logo } from './ui';
import { useCollection, useResource } from './data';
import type { AuthSession } from './auth';
import { Photo } from './photo';
export type Overview = OverviewResponse;
export type TeamSettings = TeamSettingsResponse;
export function TeamOnboarding({ session }: { session: AuthSession }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invited = session.nextStep === 'ACCEPT_INVITATION';
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(invited ? '/auth/staff-invitation/accept' : '/teams', {
        method: 'POST',
        body: invited ? {} : { name },
      });
      location.assign('/management');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decline() {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/staff-invitation/decline', { method: 'POST', body: {} });
      location.assign('/onboarding/team');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
      location.assign('/sign-in');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main id="main" className="auth-layout">
      <div className="auth-side">
        <Logo />
        <Photo eager kind="coach" />
        <div className="auth-photo-caption">
          <h2>
            YOUR TEAM.
            <br />
            YOUR NEXT CHAPTER.
          </h2>
        </div>
      </div>
      <div className="auth-main">
        <div className="auth-form">
          <p className="eyebrow">WELCOME, {session.user.name}</p>
          <h1>{invited ? 'JOIN THE COACHING TEAM.' : 'GIVE YOUR TEAM A NAME.'}</h1>
          <p>
            {invited
              ? session.pendingInvitation
                ? `You’re invited to manage ${session.pendingInvitation.teamName} as ${session.pendingInvitation.email}.`
                : 'Your verified staff account has a pending invitation. Accept it to manage the team.'
              : 'Players, dues and bank setup can follow when you’re ready.'}
          </p>
          <Feedback error={error} />
          {invited && session.pendingInvitation?.available === false && (
            <div className="notice">
              This invitation has expired or is unavailable. Ask the team for a new link, or decline
              to create your own team.
            </div>
          )}
          <form className="form-stack" onSubmit={submit}>
            {!invited && (
              <Field
                label="Team name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                maxLength={100}
                required
              />
            )}
            <Button
              busy={busy}
              disabled={invited && session.pendingInvitation?.available === false}
              type="submit"
            >
              {invited ? 'Accept invitation' : 'Create team'}
            </Button>
          </form>
          {invited && (
            <Button variant="secondary" disabled={busy} onClick={decline}>
              Decline and create my team
            </Button>
          )}
          <button className="text-action" onClick={logout}>
            Sign out and finish later
          </button>
        </div>
      </div>
    </main>
  );
}
export function TeamSettingsPage() {
  const settings = useResource<TeamSettings>('/management/team');
  const staff = useCollection<UserResponse>('/management/staff');
  const invitations = useCollection<{
    id: string;
    email: string;
    expiresAt: string;
    revokedAt: string | null;
    acceptedAt: string | null;
  }>('/management/staff-invitations');
  const banks = useResource<{ code: string; name: string }[]>('/management/banks');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function invite(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await api<{ registrationUrl: string }>('/management/staff-invitations', {
        method: 'POST',
        body: { email },
      });
      setLink(result.registrationUrl);
      setEmail('');
      await invitations.reload();
      setMessage('Invitation queued for email. You can also share the link directly.');
    });
  }
  async function resolve(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await api<{ accountName: string }>('/management/bank/resolve', {
        method: 'POST',
        body: { bankCode, accountNumber },
      });
      setAccountName(result.accountName);
      setConfirm(false);
    });
  }
  async function connect(event: FormEvent) {
    event.preventDefault();
    if (!confirm) return;
    await run(async () => {
      const result = await api<TeamSettings>('/management/bank', {
        method: 'POST',
        body: { bankCode, accountNumber, accountName, password },
      });
      setPassword('');
      setNumber('');
      setAccountName('');
      setConfirm(false);
      await settings.reload();
      setMessage(
        result.latestSetup?.status === 'READY'
          ? 'Team bank connected. Online dues payments are ready.'
          : 'The connection needs review. Check its status before trying again.',
      );
    });
    setPassword('');
  }
  const pending = settings.data?.latestSetup && settings.data.latestSetup.status !== 'READY';
  const banksAvailable = !!banks.data?.length && !banks.error && !banks.loading;
  return (
    <>
      <PageTitle
        eyebrow="MANAGEMENT / TEAM SETTINGS"
        title={settings.data?.team.name ?? 'Your team'}
      >
        Your coaching team and the bank account for online dues.
      </PageTitle>
      <Feedback error={error ?? settings.error} success={message} />
      {settings.loading ? (
        <Loading />
      ) : (
        <div className="split-grid">
          <section className="panel">
            <h2>Coaches & managers</h2>
            <p>
              All staff have full access to this team. Invitations are tied to an email and expire
              in seven days.
            </p>
            <Feedback error={staff.error ?? invitations.error} />
            {staff.items.map((member) => (
              <div className="record-row" key={member.id}>
                <strong>{member.name}</strong>
                <span>{member.email}</span>
              </div>
            ))}
            {staff.nextCursor && (
              <Button onClick={staff.more} busy={staff.busy} variant="secondary">
                More staff
              </Button>
            )}
            <form className="form-stack" onSubmit={invite}>
              <Field
                label="Staff email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button type="submit" busy={busy}>
                Invite coach or manager
              </Button>
            </form>
            {link && (
              <Field
                label="Staff invitation link"
                value={link}
                readOnly
                help="Copy now; this link cannot be recovered later."
              />
            )}
            {invitations.items.map((item) => (
              <div className="record-row" key={item.id}>
                <div>
                  <strong>{item.email}</strong>
                  <small>
                    {item.acceptedAt
                      ? 'Accepted'
                      : item.revokedAt
                        ? 'Revoked'
                        : `Expires ${dateLabel(item.expiresAt)}`}
                  </small>
                </div>
                {!item.acceptedAt && !item.revokedAt && (
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Revoke the invitation for ${item.email}? They’ll need a new link to join.`,
                        )
                      )
                        return;
                      void run(async () => {
                        await api(`/management/invitations/${item.id}`, {
                          method: 'DELETE',
                          body: {},
                        });
                        await invitations.reload();
                      });
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
            {invitations.nextCursor && (
              <Button onClick={invitations.more} busy={invitations.busy} variant="secondary">
                More invitations
              </Button>
            )}
          </section>
          <section className="panel">
            <h2>Team bank account</h2>
            <p>
              Online dues go to your team’s bank account. The platform takes no commission; your
              team pays the payment provider’s fees.
            </p>
            {settings.data?.paymentProfile && (
              <div className="notice">
                <div>
                  <strong>{settings.data.paymentProfile.accountName}</strong>
                  <p>Account ending {settings.data.paymentProfile.accountLast4} · Connected</p>
                </div>
              </div>
            )}
            <Feedback error={banks.error} />
            {banks.loading && <p role="status">Loading Nigerian banks…</p>}
            {!banks.loading && (banks.error || !banks.data?.length) && (
              <div className="form-stack">
                <p className="helper">
                  {banks.error
                    ? 'We couldn’t load the banks. Try again to continue bank setup.'
                    : 'No supported Nigerian banks are available right now. Try again shortly.'}
                </p>
                <Button variant="secondary" onClick={banks.reload}>
                  Retry loading banks
                </Button>
              </div>
            )}
            {pending ? (
              <div className="form-stack">
                <div className="notice">
                  Bank connection awaiting review. Any previously connected account remains active.
                  Checking status does not create another bank destination.
                </div>
                <Button
                  busy={busy}
                  onClick={() =>
                    run(async () => {
                      await api('/management/bank/reconcile', { method: 'POST', body: {} });
                      await settings.reload();
                      setMessage(
                        'Status checked. If review continues, contact support before retrying setup.',
                      );
                    })
                  }
                >
                  Check connection status
                </Button>
              </div>
            ) : (
              <>
                <form className="form-stack" onSubmit={resolve}>
                  <label className="field">
                    <span>Bank</span>
                    <select
                      required
                      disabled={!banksAvailable || busy}
                      value={bankCode}
                      onChange={(e) => {
                        setBankCode(e.target.value);
                        setAccountName('');
                        setConfirm(false);
                      }}
                    >
                      <option value="">
                        {banks.loading ? 'Loading Nigerian banks…' : 'Select a Nigerian bank'}
                      </option>
                      {banks.data?.map((bank) => (
                        <option key={bank.code} value={bank.code}>
                          {bank.name}
                        </option>
                      ))}
                    </select>
                    <small>
                      Choose the bank that will receive your team’s dues through Paystack.
                    </small>
                  </label>
                  <Field
                    label="Ten-digit account number"
                    inputMode="numeric"
                    pattern="[0-9]{10}"
                    minLength={10}
                    maxLength={10}
                    value={accountNumber}
                    onChange={(e) => {
                      setNumber(e.target.value.replace(/\D/g, ''));
                      setAccountName('');
                      setConfirm(false);
                    }}
                    required
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    busy={busy}
                    disabled={!banksAvailable || !bankCode || accountNumber.length !== 10}
                  >
                    Resolve account name
                  </Button>
                </form>
                {accountName && (
                  <form className="form-stack" onSubmit={connect}>
                    <Field label="Resolved account name" value={accountName} readOnly />
                    <label className="confirmation-check">
                      <input
                        type="checkbox"
                        checked={confirm}
                        onChange={(e) => setConfirm(e.target.checked)}
                        required
                      />
                      I confirm this account is authorised to receive this team’s dues.
                    </label>
                    <p className="helper">
                      Resolving an account name does not establish account ownership. Confirm the
                      details before connecting.
                    </p>
                    <Field
                      label="Confirm your password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      maxLength={128}
                      required
                    />
                    <Button type="submit" busy={busy} disabled={!confirm}>
                      {settings.data?.paymentsReady
                        ? 'Replace team bank account'
                        : 'Connect team bank account'}
                    </Button>
                    {settings.data?.paymentsReady && (
                      <p className="helper">
                        New checkouts will use this account. Existing checkouts keep their original
                        destination.
                      </p>
                    )}
                  </form>
                )}
              </>
            )}
            <div className="dashboard-links">
              <ActionLink secondary href="/management/dues">
                Set monthly dues
              </ActionLink>
              <ActionLink secondary href="/management/players">
                Invite players
              </ActionLink>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
