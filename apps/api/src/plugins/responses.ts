import { z } from 'zod';
import {
  userResponse,
  teamResponse,
  teamSettingsResponse,
  overviewResponse,
  authResponse,
  attendanceResponse,
  paymentResponse,
  trainingResponse,
  duesResponse,
  registrationResponse,
} from '@pitchpresence/shared';
export function responseSchema(method: string, url: string): z.ZodTypeAny {
  if (url === '/api/v1/auth/staff-register' || url === '/api/v1/auth/register')
    return registrationResponse;
  if (url === '/api/v1/teams') return teamResponse;
  if (url === '/api/v1/management/overview') return overviewResponse;
  if (
    [
      '/api/v1/management/team',
      '/api/v1/management/bank',
      '/api/v1/management/bank/reconcile',
    ].includes(url)
  )
    return teamSettingsResponse;
  if (
    url === '/api/v1/auth/me' ||
    url.endsWith('/device-login') ||
    url.endsWith('/staff-login') ||
    url.endsWith('/verify-email')
  )
    return authResponse;
  if (url.endsWith('/pin-reset/confirm') || url.endsWith('/password-reset/confirm'))
    return z.object({ user: userResponse });
  if (url.endsWith('/qr-token'))
    return z.object({
      token: z.string(),
      expiresAt: z.string().datetime(),
      refreshAfterSeconds: z.number().int(),
    });
  if (url.endsWith('/check-in') || url.endsWith('/attendance/manual'))
    return z.object({ attendance: attendanceResponse, alreadyRecorded: z.boolean() });
  if (
    url === '/api/v1/payments/paystack/initialize' ||
    /^\/api\/v1\/payments\/:id(?:\/verify)?$/.test(url)
  )
    return paymentResponse;
  if (
    (url === '/api/v1/training-sessions' && method === 'POST') ||
    url === '/api/v1/training-sessions/:id' ||
    url.endsWith('/close')
  )
    return trainingResponse;
  if (url.endsWith('/mark-paid'))
    return z.object({
      dues: duesResponse,
      payment: z
        .object({
          id: z.string().uuid(),
          amount: z.number(),
          provider: z.literal('EXTERNAL'),
          markedBy: z.string().uuid(),
        })
        .passthrough(),
    });
  if (url.endsWith('/reverse-manual-payment')) return duesResponse;
  if (url === '/api/v1/training-sessions' && method === 'GET')
    return z.object({ items: z.array(trainingResponse), nextCursor: z.string().uuid().nullable() });
  if (url === '/api/v1/management/players' && method === 'GET')
    return z.object({ items: z.array(userResponse), nextCursor: z.string().uuid().nullable() });
  if (url === '/api/v1/management/players/:id') return userResponse;
  if (url === '/api/v1/me/dues')
    return z.object({
      items: z.array(
        duesResponse.extend({
          minimumAmount: z.number().nullable(),
          currency: z.literal('NGN'),
          paymentAvailable: z.boolean(),
          paymentsReady: z.boolean(),
          payments: z.array(
            z.object({
              id: z.string().uuid(),
              provider: z.enum(['PAYSTACK', 'EXTERNAL']),
              status: z.enum(['PENDING', 'SUCCESS', 'FAILED']),
              amount: z.number(),
              currency: z.string(),
              paidAt: z.string().datetime().nullable(),
              reversedAt: z.string().datetime().nullable(),
              providerReference: z.string().nullable(),
            }),
          ),
        }),
      ),
      nextCursor: z.string().nullable(),
    });
  if (url.endsWith('/health/live') || url.endsWith('/health/ready'))
    return z.object({ status: z.string() });
  return z.object({}).passthrough();
}
