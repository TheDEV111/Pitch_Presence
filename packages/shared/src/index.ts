import { z } from 'zod';
export const id = z.string().uuid();
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const email = z.string().trim().toLowerCase().email().max(254);
export const pin = z.string().regex(/^\d{4}$/);
export const PASSWORD_PATTERN = String.raw`(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9\s]).{8,128}`;
export const password = z
  .string()
  .min(8)
  .max(128)
  .regex(
    new RegExp(`^${PASSWORD_PATTERN}$`),
    'Use at least 8 characters with uppercase, lowercase, a number and a symbol.',
  );
export const RECEIPT_MAX_BYTES = 2 * 1024 * 1024;
export const amount = z.number().int().min(1).max(2_000_000_000);
export const pagination = z
  .object({ cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(25) })
  .strict();
export const monthPagination = z
  .object({ cursor: month.optional(), limit: z.coerce.number().int().min(1).max(100).default(25) })
  .strict();
export const schemas = {
  staffRegister: z
    .object({
      name: z.string().trim().min(1).max(100),
      email,
      password,
      invitationToken: z.string().min(32).max(200).optional(),
    })
    .strict(),
  staffLogin: z.object({ email, password: z.string().min(1).max(128) }).strict(),
  passwordReset: z.object({ email, otp: z.string().regex(/^\d{6}$/), password }).strict(),
  team: z.object({ name: z.string().trim().min(2).max(100) }).strict(),
  staffInvitation: z.object({ email }).strict(),
  bankResolve: z
    .object({
      bankCode: z.string().regex(/^\d{3,10}$/),
      accountNumber: z.string().regex(/^\d{10}$/),
    })
    .strict(),
  bankSetup: z
    .object({
      bankCode: z.string().regex(/^\d{3,10}$/),
      accountNumber: z.string().regex(/^\d{10}$/),
      accountName: z.string().min(1).max(200),
      password: z.string().min(1).max(128),
    })
    .strict(),
  transferChange: z.discriminatedUnion('action', [
    z
      .object({
        action: z.literal('SET'),
        bankName: z.string().trim().min(2).max(100),
        accountName: z.string().trim().min(2).max(200),
        accountNumber: z.string().regex(/^\d{10}$/),
        password: z.string().min(1).max(128),
      })
      .strict(),
    z.object({ action: z.literal('REMOVE'), password: z.string().min(1).max(128) }).strict(),
  ]),
  transferConfirm: z.object({ changeId: id, otp: z.string().regex(/^\d{6}$/) }).strict(),
  receiptUpload: z
    .object({
      amount,
      accountId: id,
      fileName: z
        .string()
        .max(120)
        .regex(/^[A-Za-z0-9 _().-]+\.(pdf|png)$/i),
      mimeType: z.enum(['application/pdf', 'image/png']),
      content: z
        .string()
        .min(4)
        .max(Math.ceil(RECEIPT_MAX_BYTES / 3) * 4)
        .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
      reference: z.string().trim().max(200).optional(),
    })
    .strict(),
  receiptReview: z
    .object({
      decision: z.enum(['APPROVE', 'REJECT']),
      reason: z.string().trim().min(5).max(500).optional(),
    })
    .strict()
    .refine(
      (i) => i.decision !== 'REJECT' || !!i.reason,
      'Give a reason for rejecting this receipt.',
    ),
  register: z
    .object({
      name: z.string().trim().min(1).max(100),
      email,
      pin,
      invitationToken: z.string().min(32).max(200),
    })
    .strict(),
  login: z.object({ email, pin }).strict(),
  email: z.object({ email }).strict(),
  verify: z.object({ email, otp: z.string().regex(/^\d{6}$/) }).strict(),
  reset: z.object({ email, otp: z.string().regex(/^\d{6}$/), pin }).strict(),
  training: z
    .object({
      name: z.string().trim().min(1).max(100),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      locationAccuracy: z.number().positive().max(100),
      locationCapturedAt: z.string().datetime(),
    })
    .strict(),
  checkIn: z.object({ token: z.string().min(10).max(2048) }).strict(),
  manual: z.object({ playerId: id }).strict(),
  roster: z
    .object({ name: z.string().trim().min(1).max(100).optional(), active: z.boolean().optional() })
    .strict()
    .refine(
      (x) => x.name !== undefined || x.active !== undefined,
      'At least one field is required',
    ),
  period: z.object({ minimumAmount: amount }).strict(),
  initialize: z.object({ month, amount }).strict(),
  markPaid: z.object({ amount, externalReference: z.string().max(200).optional() }).strict(),
  reverse: z.object({ paymentId: id, reason: z.string().trim().min(5).max(500) }).strict(),
  duesQuery: z
    .object({
      month: month.optional(),
      status: z.enum(['PAID', 'NOT_PAID']).optional(),
      search: z.string().trim().max(100).optional(),
      cursor: id.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .strict(),
};
export type RegisterInput = z.infer<typeof schemas.register>;
export type TrainingInput = z.infer<typeof schemas.training>;
export type PaymentInput = z.infer<typeof schemas.initialize>;
export interface ApiError {
  error: { code: string; message: string; requestId: string; details?: unknown };
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export const QR_LIFETIME_SECONDS = 30;
export const QR_REFRESH_SECONDS = 10;
export const TEAM_TIMEZONE = 'Africa/Lagos';
export const CURRENCY = 'NGN';

// Public response contracts; server-only authentication hashes are never represented here.
export const registrationResponse = z.object({
  message: z.string(),
  resendAfterSeconds: z.number().int().min(0).max(60),
});
export type RegistrationResponse = z.infer<typeof registrationResponse>;
export const userResponse = z.object({
  id,
  email,
  name: z.string(),
  role: z.enum(['PLAYER', 'MANAGER']),
  isVerified: z.boolean(),
  active: z.boolean(),
  removedAt: z.string().datetime().nullable().optional(),
  activatedAt: z.string().datetime().nullable(),
  teamId: id.nullable(),
});
export const attendanceResponse = z.object({
  id,
  participantId: id,
  sessionId: id,
  playerId: id,
  checkedInAt: z.string().datetime(),
  method: z.enum(['QR', 'MANUAL']),
  recordedBy: id.nullable(),
});
export const paymentResponse = z.object({
  id,
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED']),
  amount,
  currency: z.literal('NGN'),
  checkoutUrl: z.string().url().nullable(),
  providerReference: z.string().nullable(),
  paidAt: z.string().datetime().nullable(),
});
export const trainingResponse = z.object({
  id,
  name: z.string(),
  date: z.string(),
  status: z.enum(['OPEN', 'CLOSED']),
  startedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  startedBy: id,
  latitude: z.number(),
  longitude: z.number(),
  locationAccuracy: z.number(),
  locationCapturedAt: z.string().datetime(),
});
export const duesResponse = z.object({
  id,
  playerId: id,
  month,
  status: z.enum(['PAID', 'NOT_PAID']),
  paidAt: z.string().datetime().nullable(),
  qualifyingPaymentId: id.nullable(),
  createdAt: z.string().datetime(),
});
export const apiErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});
export type UserResponse = z.infer<typeof userResponse>;
export type AttendanceResponse = z.infer<typeof attendanceResponse>;
export type PaymentResponse = z.infer<typeof paymentResponse>;
export type TrainingResponse = z.infer<typeof trainingResponse>;
export type DuesResponse = z.infer<typeof duesResponse>;

export const teamResponse = z.object({ id, name: z.string(), createdAt: z.string().datetime() });
export const authResponse = z.object({
  user: userResponse,
  team: teamResponse.nullable(),
  pendingInvitation: z
    .object({
      teamName: z.string(),
      email,
      expiresAt: z.string().datetime(),
      available: z.boolean(),
    })
    .nullable()
    .optional(),
  nextStep: z.enum(['CREATE_TEAM', 'ACCEPT_INVITATION', 'READY']),
  csrfToken: z.string(),
});
export type TeamResponse = z.infer<typeof teamResponse>;

export const paymentProfileResponse = z.object({
  id,
  status: z.enum(['PENDING', 'READY', 'REVIEW']),
  bankCode: z.string(),
  accountName: z.string(),
  accountLast4: z.string().length(4),
  createdAt: z.string().datetime(),
});
export const transferAccountResponse = z.object({
  id,
  bankName: z.string(),
  accountName: z.string(),
  accountNumber: z.string().regex(/^\d{10}$/),
  createdAt: z.string().datetime(),
});
export const receiptAccountResponse = z.object({
  id,
  bankName: z.string(),
  accountName: z.string(),
  accountLast4: z.string().length(4),
});
export type ReceiptAccountResponse = z.infer<typeof receiptAccountResponse>;
export const receiptResponse = z.object({
  id,
  paymentId: id,
  accountId: id,
  fileName: z.string(),
  mimeType: z.enum(['application/pdf', 'image/png']),
  size: z.number().int(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  reason: z.string().nullable(),
  createdAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  reviewedBy: id.nullable(),
  fileAvailable: z.boolean(),
});
export type ReceiptResponse = z.infer<typeof receiptResponse>;
export type TransferAccountResponse = z.infer<typeof transferAccountResponse>;
export const teamSettingsResponse = z.object({
  team: teamResponse,
  paymentMode: z.enum(['MANUAL', 'PAYSTACK']),
  transferAccount: transferAccountResponse.nullable(),
  pendingBankChange: z
    .object({
      id,
      action: z.enum(['SET', 'REMOVE']),
      accountName: z.string().nullable(),
      bankName: z.string().nullable(),
      accountLast4: z.string().nullable(),
      requestedBy: id,
      expiresAt: z.string().datetime(),
    })
    .nullable(),
  paymentsReady: z.boolean(),
  paymentProfile: paymentProfileResponse.nullable(),
  latestSetup: paymentProfileResponse.nullable(),
});
export const overviewResponse = teamSettingsResponse.extend({
  currentSession: trainingResponse.nullable(),
  recentSessions: z.array(trainingResponse),
  players: z.object({
    active: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  dues: z.object({
    month,
    paid: z.number().int().nonnegative(),
    unpaid: z.number().int().nonnegative(),
    minimumAmount: amount.nullable(),
  }),
  setup: z.object({
    hasPlayers: z.boolean(),
    duesConfigured: z.boolean(),
    paymentsReady: z.boolean(),
  }),
});
export type TeamSettingsResponse = z.infer<typeof teamSettingsResponse>;
export type OverviewResponse = z.infer<typeof overviewResponse>;
export type PaymentProfileResponse = z.infer<typeof paymentProfileResponse>;

export type AuthResponse = z.infer<typeof authResponse>;
