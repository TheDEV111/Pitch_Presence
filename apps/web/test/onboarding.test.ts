import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  pendingVerification,
  rememberVerification,
  forgetVerification,
} from '../src/lib/onboarding';
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('restores the pending email and cooldown without retaining passwords, PINs, codes or invitations', () => {
  const saved = rememberVerification(' Coach@Example.com ', 'MANAGER', 60);
  expect(pendingVerification('MANAGER')).toEqual(saved);
  expect(saved.email).toBe('coach@example.com');
  expect(Object.keys(JSON.parse([...values.values()][0]!)).sort()).toEqual([
    'email',
    'expiresAt',
    'resendAt',
    'role',
  ]);
  expect(pendingVerification('PLAYER')).toBeNull();
});
it('expires the hint after a day and rejects malformed or unbounded cooldown state', () => {
  vi.useFakeTimers();
  rememberVerification('coach@example.com', 'MANAGER', 60);
  vi.advanceTimersByTime(86400_001);
  expect(pendingVerification('MANAGER')).toBeNull();
  rememberVerification('coach@example.com', 'MANAGER');
  const storageKey = [...values.keys()][0]!;
  values.set(
    storageKey,
    JSON.stringify({
      email: 'coach@example.com',
      role: 'MANAGER',
      expiresAt: Date.now() + 1000,
      resendAt: Date.now() + 1000000,
    }),
  );
  expect(pendingVerification('MANAGER')).toBeNull();
  values.set(storageKey, '{invalid');
  expect(pendingVerification('MANAGER')).toBeNull();
});
it('clears only the matching completed account while keeping another pending role', () => {
  rememberVerification('coach@example.com', 'MANAGER');
  rememberVerification('player@example.com', 'PLAYER');
  forgetVerification('MANAGER', 'someone@example.com');
  expect(pendingVerification('MANAGER')).not.toBeNull();
  forgetVerification('MANAGER', 'COACH@example.com');
  expect(pendingVerification('MANAGER')).toBeNull();
  expect(pendingVerification('PLAYER')).not.toBeNull();
});
it('keeps verification usable when browser storage is blocked', () => {
  vi.stubGlobal('sessionStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  expect(rememberVerification('coach@example.com', 'MANAGER').email).toBe('coach@example.com');
  expect(pendingVerification('MANAGER')).toBeNull();
  expect(() => forgetVerification('MANAGER')).not.toThrow();
});
