export type VerificationRole = 'MANAGER' | 'PLAYER';
export interface PendingVerification {
  email: string;
  role: VerificationRole;
  resendAt: number;
  expiresAt: number;
}
const key = (role: VerificationRole) => `pitchpresence:verification:${role}`;
const invitationKey = (role: VerificationRole) => `pitchpresence:join:${role}`;
export function forgetInvitationContext(role: VerificationRole) {
  try {
    sessionStorage.removeItem(invitationKey(role));
  } catch {
    /* Storage is optional. */
  }
}
export function rememberInvitationContext(role: VerificationRole, id: string, expiresAt: string) {
  try {
    sessionStorage.setItem(
      invitationKey(role),
      JSON.stringify({ id, expiresAt: Date.parse(expiresAt) }),
    );
  } catch {
    /* The original link still works without storage. */
  }
}
export function pendingInvitationContext(
  role: VerificationRole,
): { id: string; expiresAt: number } | null {
  try {
    const raw = sessionStorage.getItem(invitationKey(role));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (
      typeof data.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id) ||
      typeof data.expiresAt !== 'number' ||
      !Number.isFinite(data.expiresAt) ||
      data.expiresAt <= Date.now() ||
      data.expiresAt > Date.now() + 86400000
    ) {
      forgetInvitationContext(role);
      return null;
    }
    return { id: data.id, expiresAt: data.expiresAt };
  } catch {
    forgetInvitationContext(role);
    return null;
  }
}
export function pendingVerification(role: VerificationRole): PendingVerification | null {
  try {
    const raw = sessionStorage.getItem(key(role));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingVerification>;
    if (
      value.role !== role ||
      typeof value.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
      value.email.length > 254 ||
      typeof value.resendAt !== 'number' ||
      !Number.isFinite(value.resendAt) ||
      typeof value.expiresAt !== 'number' ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= Date.now() ||
      value.expiresAt > Date.now() + 86400_000 ||
      value.resendAt > Date.now() + 60000
    ) {
      sessionStorage.removeItem(key(role));
      return null;
    }
    return { email: value.email, role, resendAt: value.resendAt, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}
export function rememberVerification(
  email: string,
  role: VerificationRole,
  resendAfterSeconds = 0,
) {
  const value: PendingVerification = {
    email: email.trim().toLowerCase(),
    role,
    resendAt: Date.now() + Math.max(0, Math.min(60, resendAfterSeconds)) * 1000,
    expiresAt: Date.now() + 86400_000,
  };
  try {
    sessionStorage.setItem(key(role), JSON.stringify(value));
  } catch {
    /* Storage is optional. */
  }
  return value;
}
export function forgetVerification(role: VerificationRole, email?: string) {
  try {
    const pending = pendingVerification(role);
    if (!email || pending?.email === email.trim().toLowerCase())
      sessionStorage.removeItem(key(role));
  } catch {
    /* Storage is optional. */
  }
}
