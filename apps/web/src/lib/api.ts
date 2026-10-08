import type { ApiError } from '@pitchpresence/shared';

let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}
export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; key?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  if (method !== 'GET' && typeof navigator !== 'undefined' && navigator.onLine === false)
    throw new RequestError(0, 'OFFLINE', 'Reconnect before submitting. No changes were sent.');
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      signal: options.signal,
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new RequestError(0, 'OFFLINE', 'Unable to connect. Check your connection and try again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = data as ApiError | null;
    const error = new RequestError(
      response.status,
      failure?.error?.code ?? 'UNAVAILABLE',
      failure?.error?.message ?? 'The service is unavailable. Please try again.',
      failure?.error?.requestId,
    );
    if (error.code === 'PLAYER_REMOVED' && path !== '/auth/device-login')
      window.dispatchEvent(new CustomEvent('player-removed', { detail: error.message }));
    if (
      response.status === 401 &&
      error.code !== 'REAUTHENTICATION_FAILED' &&
      ![
        '/auth/me',
        '/auth/staff-login',
        '/auth/device-login',
        '/auth/verify-email',
        '/auth/pin-reset/confirm',
        '/auth/password-reset/confirm',
      ].includes(path)
    )
      window.dispatchEvent(new Event('session-expired'));
    throw error;
  }
  return data as T;
}
