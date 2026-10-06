import type { Config } from '../config/index.js';
import { z } from 'zod';
import { AppError } from '../plugins/core.js';
const bankPage = z.object({
  data: z.array(
    z.object({
      code: z.string().regex(/^\d{3,10}$/),
      name: z.string().trim().min(1),
      active: z.boolean(),
      is_deleted: z.boolean(),
      country: z.string(),
      currency: z.string(),
      type: z.string(),
    }),
  ),
  meta: z.object({ next: z.string().nullable().optional() }).optional(),
});
export interface Bank {
  code: string;
  name: string;
}
export interface Subaccount {
  code: string;
  active: boolean;
  profileId: string | null;
  accountName: string;
  accountLast4: string;
  bankCode: string;
}
export interface VerifiedCharge {
  subaccountCode: string | null;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  email: string;
  paidAt: string | null;
}
export interface Providers {
  sendStaffInvitation(email: string, url: string, key: string): Promise<void>;
  banks(): Promise<Bank[]>;
  resolveBank(bankCode: string, accountNumber: string): Promise<string>;
  createSubaccount(input: {
    name: string;
    bankCode: string;
    accountNumber: string;
    profileId: string;
  }): Promise<Subaccount>;
  findSubaccount(profileId: string): Promise<Subaccount | null>;
  sendOtp(email: string, otp: string, purpose: string, key: string): Promise<void>;
  initialize(input: {
    email: string;
    amount: number;
    reference: string;
    callbackUrl: string;
    subaccountCode: string;
  }): Promise<string>;
  verify(reference: string): Promise<VerifiedCharge>;
}
async function request(url: string, secret: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'The provider is temporarily unavailable.');
  return response.json();
}
export function createProviders(config: Config): Providers {
  const paystack = async (path: string, init?: RequestInit) => {
    if (!config.PAYSTACK_SECRET_KEY)
      throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Payments are not configured.');
    const result = (await request(
      `https://api.paystack.co${path}`,
      config.PAYSTACK_SECRET_KEY,
      init,
    )) as { status: boolean; data: unknown; meta?: { pageCount: number } };
    if (!result.status)
      throw new AppError(
        503,
        'PROVIDER_UNAVAILABLE',
        'The bank service is temporarily unavailable.',
      );
    return result;
  };
  type RawSubaccount = {
    subaccount_code: string;
    active: boolean;
    account_name: string;
    account_number: string;
    settlement_bank: string;
    metadata?: { profileId?: string };
  };
  const presentSubaccount = (data: RawSubaccount): Subaccount => ({
    code: data.subaccount_code,
    active: data.active === true,
    profileId: data.metadata?.profileId ?? null,
    accountName: data.account_name,
    accountLast4: data.account_number.slice(-4),
    bankCode: data.settlement_bank,
  });
  return {
    async banks() {
      const banks = new Map<string, Bank>();
      const cursors = new Set<string>();
      let next: string | undefined;
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({
          country: 'nigeria',
          currency: 'NGN',
          perPage: '100',
          use_cursor: 'true',
          ...(next ? { next } : {}),
        });
        const result = bankPage.safeParse(await paystack(`/bank?${query}`));
        if (!result.success)
          throw new AppError(
            503,
            'PROVIDER_UNAVAILABLE',
            'The bank list is temporarily unavailable.',
          );
        for (const bank of result.data.data) {
          if (
            bank.active &&
            !bank.is_deleted &&
            bank.country.toLowerCase() === 'nigeria' &&
            bank.currency === 'NGN' &&
            bank.type === 'nuban'
          )
            banks.set(bank.code, { code: bank.code, name: bank.name });
        }
        next = result.data.meta?.next ?? undefined;
        if (!next) return [...banks.values()].sort((a, b) => a.name.localeCompare(b.name, 'en-NG'));
        if (cursors.has(next)) break;
        cursors.add(next);
      }
      throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'The bank list could not finish loading.');
    },
    async resolveBank(bankCode, accountNumber) {
      const data = (
        await paystack(
          `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
        )
      ).data as { account_name: string };
      if (!data.account_name)
        throw new AppError(422, 'BANK_ACCOUNT_INVALID', 'The account could not be resolved.');
      return data.account_name;
    },
    async createSubaccount(input) {
      const data = (
        await paystack('/subaccount', {
          method: 'POST',
          body: JSON.stringify({
            business_name: input.name,
            settlement_bank: input.bankCode,
            account_number: input.accountNumber,
            percentage_charge: 0,
            metadata: { profileId: input.profileId },
          }),
        })
      ).data as RawSubaccount;
      return presentSubaccount(data);
    },
    async findSubaccount(profileId) {
      for (let page = 1; page <= 100; page++) {
        const result = await paystack(`/subaccount?perPage=100&page=${page}`);
        const data = result.data as RawSubaccount[];
        const matches = data.filter((row) => row.metadata?.profileId === profileId);
        if (matches.length > 1)
          throw new AppError(
            409,
            'BANK_REVIEW_REQUIRED',
            'Multiple bank destinations need review.',
          );
        if (matches[0]) return presentSubaccount(matches[0]);
        if (data.length < 100 || (result.meta && page >= result.meta.pageCount)) return null;
      }
      throw new AppError(503, 'BANK_REVIEW_REQUIRED', 'Bank reconciliation could not finish.');
    },
    async sendStaffInvitation(email, url, key) {
      if (!config.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
      await request('https://api.resend.com/emails', config.RESEND_API_KEY, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({
          from: config.EMAIL_FROM,
          to: [email],
          subject: 'Join your team on PitchPresence',
          text: `Your coach or manager invited you to manage their team. Open ${url} to create or sign in to your staff account. This invitation is for ${email} and expires in seven days.`,
        }),
      });
    },
    async sendOtp(email, otp, purpose, key) {
      if (!config.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
      await request('https://api.resend.com/emails', config.RESEND_API_KEY, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({
          from: config.EMAIL_FROM,
          to: [email],
          subject: `PitchPresence ${purpose === 'PIN_RESET' ? 'PIN reset' : purpose === 'PASSWORD_RESET' ? 'password reset' : 'email verification'}`,
          text: `Your PitchPresence code is ${otp}. It expires in 10 minutes.`,
        }),
      });
    },
    async initialize(input) {
      if (!config.PAYSTACK_SECRET_KEY)
        throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Payments are not configured.');
      const result = (await request(
        'https://api.paystack.co/transaction/initialize',
        config.PAYSTACK_SECRET_KEY,
        {
          method: 'POST',
          body: JSON.stringify({
            email: input.email,
            amount: input.amount,
            reference: input.reference,
            currency: 'NGN',
            subaccount: input.subaccountCode,
            transaction_charge: 0,
            bearer: 'subaccount',
            callback_url: input.callbackUrl,
          }),
        },
      )) as { status: boolean; data?: { authorization_url: string } };
      if (!result.status || !result.data?.authorization_url)
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Unable to initialize payment.');
      const url = new URL(result.data.authorization_url);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.paystack.com'))
        throw new Error('Unexpected Paystack checkout URL');
      return url.toString();
    },
    async verify(reference) {
      const result = (await request(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        config.PAYSTACK_SECRET_KEY,
      )) as {
        status: boolean;
        data?: {
          reference: string;
          status: string;
          amount: number;
          currency: string;
          customer: { email: string };
          paid_at: string | null;
          subaccount?: { subaccount_code?: string } | string | null;
        };
      };
      if (!result.status || !result.data)
        throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Payment verification is unavailable.');
      return {
        ...result.data,
        subaccountCode:
          typeof result.data.subaccount === 'string'
            ? result.data.subaccount
            : (result.data.subaccount?.subaccount_code ?? null),
        email: result.data.customer.email.trim().toLowerCase(),
        paidAt: result.data.paid_at,
      };
    },
  };
}
