'use client';
import { useRef, useState, type FormEvent } from 'react';
import {
  RECEIPT_MAX_BYTES,
  type ReceiptResponse,
  type TeamSettingsResponse,
  type UserResponse,
} from '@pitchpresence/shared';
import { api } from '@/lib/api';
import { money, parseMoney, dateLabel } from '@/lib/format';
import type { DuesRecord, PaymentRecord } from '@/lib/types';
import { Button, Feedback, Field, Status } from './ui';

export function TransferAccountSettings({
  settings,
  user,
  reload,
}: {
  settings: TeamSettingsResponse;
  user: UserResponse;
  reload: () => Promise<unknown>;
}) {
  const [bankName, setBank] = useState('');
  const [accountName, setName] = useState('');
  const [accountNumber, setNumber] = useState('');
  const [password, setPassword] = useState('');
  const [remove, setRemove] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pending = settings.pendingBankChange;
  const own = pending?.requestedBy === user.id;
  async function request(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ message: string }>('/management/transfer-account/request', {
        method: 'POST',
        body: remove
          ? { action: 'REMOVE', password }
          : { action: 'SET', bankName, accountName, accountNumber, password },
      });
      setOtp('');
      setMessage(result.message);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPassword('');
      setBusy(false);
    }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await api('/management/transfer-account/confirm', {
        method: 'POST',
        body: { changeId: pending.id, otp },
      });
      setOtp('');
      setNumber('');
      setName('');
      setBank('');
      setRemove(false);
      setConfirmed(false);
      setMessage(
        'Bank change confirmed. All active coaches and managers will receive an email notification.',
      );
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-stack">
      <h2>Team transfer account</h2>
      <p>
        Players transfer dues directly to this account and upload their receipt. Staff confirm the
        funds have arrived.
      </p>
      {settings.transferAccount ? (
        <div className="notice">
          <div>
            <strong>{settings.transferAccount.accountName}</strong>
            <p>
              {settings.transferAccount.bankName} · {settings.transferAccount.accountNumber}
            </p>
          </div>
        </div>
      ) : (
        <p className="helper">
          No transfer account is active. Add one before asking players to pay.
        </p>
      )}
      <Feedback error={error} success={message} />
      {pending && (
        <div className="notice">
          <div>
            <strong>
              {pending.action === 'REMOVE'
                ? 'Removal awaiting email confirmation'
                : 'New account awaiting email confirmation'}
            </strong>
            <p>
              {pending.bankName} {pending.accountName}{' '}
              {pending.accountLast4 ? `· ending ${pending.accountLast4}` : ''}
            </p>
            <small>Expires {dateLabel(pending.expiresAt)}. Existing details remain active.</small>
          </div>
        </div>
      )}
      {pending && own && (
        <form className="form-stack" onSubmit={confirm}>
          <Field
            label="Bank change email code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            required
          />
          <Button type="submit" busy={busy}>
            Confirm bank change
          </Button>
        </form>
      )}
      {pending && !own && (
        <p className="helper">
          Another staff member requested this change. Only their account can confirm it.
        </p>
      )}
      <form className="form-stack" onSubmit={request}>
        {settings.transferAccount && (
          <label className="confirmation-check">
            <input
              type="checkbox"
              checked={remove}
              onChange={(e) => {
                setRemove(e.target.checked);
                setConfirmed(false);
              }}
            />
            Remove the active account
          </label>
        )}
        {!remove && (
          <>
            <Field
              label="Bank name"
              value={bankName}
              onChange={(e) => {
                setBank(e.target.value);
                setConfirmed(false);
              }}
              minLength={2}
              maxLength={100}
              placeholder="e.g. Guaranty Trust Bank"
              required
            />
            <Field
              label="Account holder name"
              value={accountName}
              onChange={(e) => {
                setName(e.target.value);
                setConfirmed(false);
              }}
              minLength={2}
              maxLength={200}
              required
            />
            <Field
              label="Ten-digit account number"
              inputMode="numeric"
              pattern="[0-9]{10}"
              minLength={10}
              maxLength={10}
              value={accountNumber}
              onChange={(e) => {
                setNumber(e.target.value.replace(/\D/g, ''));
                setConfirmed(false);
              }}
              required
            />
          </>
        )}
        <p className="helper">
          Check these details with your bank. Account ownership is not checked automatically. Each
          request replaces any pending code; limits apply to repeated changes.
        </p>
        <label className="confirmation-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            required
          />
          {remove
            ? 'I confirm the team should stop using this account.'
            : 'I checked these details and this account is authorised to receive team dues.'}
        </label>
        <Field
          label="Confirm your password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={128}
          required
        />
        <Button type="submit" busy={busy} disabled={!confirmed}>
          {remove
            ? 'Email removal code'
            : settings.transferAccount
              ? 'Email replacement code'
              : 'Email account confirmation code'}
        </Button>
      </form>
    </div>
  );
}

export function ReceiptUpload({
  dues,
  reload,
}: {
  dues: DuesRecord;
  reload: () => Promise<unknown>;
}) {
  const accounts =
    dues.receiptAccounts ??
    (dues.transferAccount
      ? [{ ...dues.transferAccount, accountLast4: dues.transferAccount.accountNumber.slice(-4) }]
      : []);
  const [accountId, setAccountId] = useState(dues.transferAccount?.id ?? accounts[0]?.id ?? '');
  const [amount, setAmount] = useState(String((dues.minimumAmount ?? 0) / 100));
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pending = dues.payments.some((p) => p.receipt?.status === 'PENDING');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !accountId || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (file.size > RECEIPT_MAX_BYTES || !/\.(pdf|png)$/i.test(file.name))
        throw new Error('Choose a PDF or PNG receipt up to 2 MB.');
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]!);
        reader.onerror = () =>
          reject(new Error('Could not read this file. Please choose it again.'));
        reader.readAsDataURL(file);
      });
      const extension = /\.png$/i.test(file.name) ? 'png' : 'pdf';
      await api(`/me/dues/${dues.id}/receipt`, {
        method: 'POST',
        body: {
          amount: parseMoney(amount),
          accountId,
          reference,
          fileName: `receipt.${extension}`,
          mimeType: extension === 'png' ? 'image/png' : 'application/pdf',
          content: encoded,
        },
      });
      setMessage('Proof submitted. Your coach or manager will confirm the transfer.');
      setFile(null);
      setConfirmed(false);
      if (fileInput.current) fileInput.current.value = '';
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-stack">
      <h3>Pay by bank transfer</h3>
      {dues.transferAccount ? (
        <div className="notice">
          <div>
            <strong>{dues.transferAccount.accountName}</strong>
            <p>{dues.transferAccount.bankName}</p>
            <p className="account-number">{dues.transferAccount.accountNumber}</p>
            <small>Confirm the current details here before every transfer.</small>
          </div>
        </div>
      ) : (
        <p className="helper">
          There is no active transfer account. Contact your coach before making a new payment. If
          you already paid, select the previous account below.
        </p>
      )}
      <Feedback error={error} success={message} />
      {pending ? (
        <p role="status" className="notice">
          Proof submitted · awaiting staff confirmation. You do not need to pay or upload again.
        </p>
      ) : (
        dues.status === 'NOT_PAID' && (
          <form className="form-stack" onSubmit={submit}>
            <label className="field">
              <span>Account used for this transfer</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                <option value="">Select the account you paid</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bankName} · {account.accountName} · ending {account.accountLast4}
                    {account.id === dues.transferAccount?.id ? ' (current)' : ' (previous)'}
                  </option>
                ))}
              </select>
              <small>
                Select the destination shown on your receipt. Previous accounts are listed only for
                payments already made.
              </small>
            </label>
            <Field
              label="Transferred amount in naira"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              help={
                dues.minimumAmount
                  ? `Minimum ${money(dues.minimumAmount)}`
                  : 'Management must configure the monthly minimum.'
              }
              required
            />
            <Field
              label="Transfer reference (optional)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={200}
            />
            <label className="field">
              <span>Payment receipt (PDF or PNG)</span>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,image/png,.pdf,.png"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
              />
              <small>Up to 2 MB. Keep your name, amount, date and destination visible.</small>
            </label>
            <label className="confirmation-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                required
              />
              I have already transferred this amount to the team.
            </label>
            <Button
              type="submit"
              busy={busy}
              disabled={!dues.proofAvailable || !accountId || !file || !confirmed}
            >
              Submit payment proof
            </Button>
          </form>
        )
      )}
    </div>
  );
}

export function ReceiptDownload({ receipt }: { receipt: ReceiptResponse }) {
  return receipt.fileAvailable ? (
    <a className="text-action" href={`/api/v1/receipts/${receipt.id}/file`} download>
      Download receipt
    </a>
  ) : (
    <small>Receipt file expired; payment history retained.</small>
  );
}
export function ReceiptReview({
  payment,
  reload,
}: {
  payment: PaymentRecord;
  reload: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receipt = payment.receipt;
  if (!receipt) return null;
  async function review(decision: 'APPROVE' | 'REJECT') {
    setBusy(true);
    setError(null);
    try {
      await api(`/management/receipts/${receipt!.id}/review`, {
        method: 'POST',
        body: { decision, ...(reason ? { reason } : {}) },
      });
      setOpen(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="receipt-review form-stack">
      <Status value={receipt.status === 'PENDING' ? 'PROOF_SUBMITTED' : receipt.status} />
      <ReceiptDownload receipt={receipt} />
      {receipt.reason && <p className="helper">Staff note: {receipt.reason}</p>}
      {receipt.status === 'PENDING' && (
        <Button variant="secondary" onClick={() => setOpen(!open)}>
          {open ? 'Close review' : 'Review receipt'}
        </Button>
      )}
      {open && (
        <div className="form-stack">
          <Feedback error={error} />
          <p>
            Check the team’s bank statement. A receipt alone does not confirm that funds arrived.
          </p>
          <label className="confirmation-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I confirmed {money(payment.amount)} arrived in the team account.
          </label>
          <Field
            label="Review note / rejection reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            help="A reason of at least 5 characters is required to reject."
          />
          <Button busy={busy} disabled={!confirmed} onClick={() => review('APPROVE')}>
            Approve receipt and mark paid
          </Button>
          <Button
            variant="secondary"
            busy={busy}
            disabled={reason.trim().length < 5}
            onClick={() => review('REJECT')}
          >
            Reject receipt
          </Button>
        </div>
      )}
    </div>
  );
}
