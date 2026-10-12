'use client';
import { useState } from 'react';
import type { AuthSession } from './auth';
import { sessionHome } from './auth';
import { api, setCsrfToken } from '@/lib/api';
import { Button, Feedback, Field } from './ui';
import Link from 'next/link';

export function TeamSwitcher({ session }: { session: AuthSession }) {
  const memberships = session.memberships ?? [];
  const [selected, setSelected] = useState(session.user.id);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = memberships.find((m) => m.id === selected);
  const stepUp = target?.role === 'MANAGER' && session.authMethod === 'PIN';
  if (memberships.length < 2) return null;
  return (
    <details className="team-switcher">
      <summary>Switch team</summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const next = await api<AuthSession>('/auth/memberships/switch', {
              method: 'POST',
              body: {
                membershipId: selected,
                ...(stepUp ? { password } : {}),
              },
            });
            setCsrfToken(next.csrfToken, next.user.id);
            location.assign(sessionHome(next));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        className="form-stack"
      >
        <label>
          Team and role
          <select
            aria-label="Team and role"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setPassword('');
              setError(null);
            }}
          >
            {memberships.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.active || !!m.removedAt}>
                {m.teamName} — {m.role === 'MANAGER' ? 'Coach / manager' : 'Player'}
                {m.removedAt ? ' (removed)' : !m.active ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
        </label>
        {stepUp && (
          <>
            <Field
              label="Account password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Link href="/forgot-password">Set or recover your password</Link>
          </>
        )}
        <Feedback error={error} />
        <Button
          type="submit"
          busy={busy}
          disabled={selected === session.user.id || !target?.active || !!target?.removedAt}
        >
          Open team
        </Button>
        <p>Enable receipt notifications for your selected team in Account settings.</p>
      </form>
    </details>
  );
}
