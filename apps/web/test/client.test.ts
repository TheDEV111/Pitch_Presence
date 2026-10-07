import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, RequestError, setCsrfToken } from '../src/lib/api';
import { currentMonth, parseMoney, safeReturn } from '../src/lib/format';
afterEach(() => {
  setCsrfToken(null);
  vi.unstubAllGlobals();
});
describe('naira amounts and team time', () => {
  it('converts decimals exactly to kobo without rounding underpayments', () => {
    expect(parseMoney('5000.01')).toBe(500001);
    expect(parseMoney('0.29')).toBe(29);
    expect(parseMoney('020.5')).toBe(2050);
    for (const value of ['-1', '0', '1.001', '5,000', '5e3', 'Infinity', '20000000.01'])
      expect(() => parseMoney(value)).toThrow();
  });
  it('changes the dues month at Lagos midnight', () => {
    expect(currentMonth(new Date('2026-09-30T22:59:59Z'))).toBe('2026-09');
    expect(currentMonth(new Date('2026-09-30T23:00:00Z'))).toBe('2026-10');
  });
  it('rejects external return destinations', () => {
    expect(safeReturn('/dues')).toBe('/dues');
    for (const path of ['//evil.example', 'https://evil.example', '/\\evil.example'])
      expect(safeReturn(path)).toBeNull();
  });
});
describe('authenticated API client', () => {
  it('blocks offline mutations without sending or queuing a request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('navigator', { onLine: false });
    await expect(
      api('/attendance/check-in', { method: 'POST', body: { token: 'example' } }),
    ).rejects.toMatchObject({ code: 'OFFLINE', status: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses no-store cookies, in-memory CSRF, and stable checkout idempotency', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'PENDING' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    setCsrfToken('csrf-example');
    await api('/payments/paystack/initialize', {
      method: 'POST',
      body: { month: '2026-10', amount: 500000 },
      key: 'attempt-123',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/payments/paystack/initialize',
      expect.objectContaining({
        credentials: 'include',
        cache: 'no-store',
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf-example',
          'Idempotency-Key': 'attempt-123',
        }),
        body: '{"month":"2026-10","amount":500000}',
      }),
    );
  });
  it('preserves structured server failures and expires protected sessions', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'SESSION_EXPIRED', message: 'Sign in again.', requestId: 'request-1' },
          }),
          { status: 401 },
        ),
      ),
    );
    await expect(api('/me/dues')).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_EXPIRED',
      requestId: 'request-1',
    });
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });
  it('explains unavailable upstreams without treating HTML as successful data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })));
    await expect(api('/me/dues')).rejects.toBeInstanceOf(RequestError);
  });
  it('preserves cancellation instead of displaying an offline error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')));
    await expect(api('/auth/me')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
