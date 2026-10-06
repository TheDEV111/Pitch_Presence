import { afterEach, expect, it, vi } from 'vitest';
import { createProviders } from '../../src/infrastructure/providers.js';
import { loadConfig } from '../../src/config/index.js';
const config = loadConfig({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'provider-session-secret-000000000000000',
  QR_SIGNING_SECRET: 'provider-qr-secret-00000000000000000000',
  PAYSTACK_SECRET_KEY: 'sk_test_placeholder',
  RESEND_API_KEY: 're_test_placeholder',
  LOG_LEVEL: 'silent',
});
afterEach(() => vi.unstubAllGlobals());
const nigeriaBank = (code: string, name: string) => ({
  code,
  name,
  active: true,
  is_deleted: false,
  country: 'Nigeria',
  currency: 'NGN',
  type: 'nuban',
});
it('loads all Nigerian bank pages, excludes unsupported entries and returns unique names in order', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: true,
          data: [
            nigeriaBank('057', 'Zenith Bank'),
            { ...nigeriaBank('001', 'Inactive Bank'), active: false },
            { ...nigeriaBank('002', 'Deleted Bank'), is_deleted: true },
            { ...nigeriaBank('003', 'Other Country Bank'), country: 'Ghana' },
            { ...nigeriaBank('004', 'Other Currency Bank'), currency: 'USD' },
            { ...nigeriaBank('005', 'Mobile Wallet'), type: 'mobile_money' },
          ],
          meta: { next: 'bank:next+page=' },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: true,
          data: [nigeriaBank('044', 'Access Bank'), nigeriaBank('057', 'Zenith Bank')],
          meta: { next: null },
        }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  expect(await createProviders(config).banks()).toEqual([
    { code: '044', name: 'Access Bank' },
    { code: '057', name: 'Zenith Bank' },
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url, options] of fetch.mock.calls) {
    expect(new URL(url).searchParams.get('country')).toBe('nigeria');
    expect(new URL(url).searchParams.get('currency')).toBe('NGN');
    expect(new URL(url).searchParams.get('use_cursor')).toBe('true');
    expect(new URL(url).searchParams.get('perPage')).toBe('100');
    expect(options.headers.Authorization).toBe(`Bearer ${config.PAYSTACK_SECRET_KEY}`);
  }
  expect(new URL(fetch.mock.calls[1]![0]).searchParams.get('next')).toBe('bank:next+page=');
});
it('rejects a repeated bank cursor instead of returning an incomplete list', async () => {
  const fetch = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          status: true,
          data: [nigeriaBank('044', 'Access Bank')],
          meta: { next: 'repeated-cursor' },
        }),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(createProviders(config).banks()).rejects.toMatchObject({
    code: 'PROVIDER_UNAVAILABLE',
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('rejects malformed bank data and requires a server-side Paystack key', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ status: true, data: null })));
  vi.stubGlobal('fetch', fetch);
  await expect(createProviders(config).banks()).rejects.toMatchObject({
    code: 'PROVIDER_UNAVAILABLE',
  });
  fetch.mockClear();
  await expect(
    createProviders({ ...config, PAYSTACK_SECRET_KEY: '' }).banks(),
  ).rejects.toMatchObject({
    code: 'PAYMENTS_UNAVAILABLE',
  });
  expect(fetch).not.toHaveBeenCalled();
});
it('routes the full gross charge to the snapshotted team and assigns fees to that subaccount', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: true,
        data: { authorization_url: 'https://checkout.paystack.com/transaction' },
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  await createProviders(config).initialize({
    email: 'player@test.com',
    amount: 100000,
    reference: 'pp_example',
    callbackUrl: 'http://localhost:3000/dues/payment-return',
    subaccountCode: 'ACCT_team_a',
  });
  const request = fetch.mock.calls[0]!;
  expect(request[0]).toBe('https://api.paystack.co/transaction/initialize');
  expect(JSON.parse(request[1].body)).toMatchObject({
    amount: 100000,
    currency: 'NGN',
    subaccount: 'ACCT_team_a',
    transaction_charge: 0,
    bearer: 'subaccount',
  });
});
it('creates a zero-commission correlated subaccount using bank code and confirms provider active separately', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: true,
        data: {
          subaccount_code: 'ACCT_test',
          active: true,
          is_verified: false,
          account_name: 'TEAM A',
          account_number: '0123456789',
          settlement_bank: 'Example Bank',
          metadata: { profileId: 'profile-a' },
        },
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const result = await createProviders(config).createSubaccount({
    name: 'Team A',
    bankCode: '058',
    accountNumber: '0123456789',
    profileId: 'profile-a',
  });
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
    business_name: 'Team A',
    settlement_bank: '058',
    account_number: '0123456789',
    percentage_charge: 0,
    metadata: { profileId: 'profile-a' },
  });
  expect(result).toMatchObject({ active: true, profileId: 'profile-a', accountLast4: '6789' });
});
it('preserves the verified destination and rejects a checkout URL outside Paystack', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            reference: 'ref',
            status: 'success',
            amount: 100000,
            currency: 'NGN',
            customer: { email: 'PLAYER@TEST.COM' },
            paid_at: null,
            subaccount: { subaccount_code: 'ACCT_original' },
          },
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: true,
          data: { authorization_url: 'https://paystack.com.attacker.test/checkout' },
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal('fetch', fetch);
  expect(await createProviders(config).verify('ref')).toMatchObject({
    email: 'player@test.com',
    subaccountCode: 'ACCT_original',
  });
  await expect(
    createProviders(config).initialize({
      email: 'player@test.com',
      amount: 100000,
      reference: 'ref',
      callbackUrl: config.APP_URL,
      subaccountCode: 'ACCT_original',
    }),
  ).rejects.toThrow('Unexpected');
});
it('reconciles a creation by metadata without a provider mutation', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: true,
        data: [
          {
            subaccount_code: 'ACCT_existing',
            active: true,
            account_name: 'TEAM A',
            account_number: '0123456789',
            settlement_bank: 'Bank',
            metadata: { profileId: 'profile-a' },
          },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  expect((await createProviders(config).findSubaccount('profile-a'))?.code).toBe('ACCT_existing');
  expect(fetch.mock.calls[0]![1].method).toBeUndefined();
});
