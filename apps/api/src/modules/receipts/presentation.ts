import type { PaymentReceipt } from '@pitchpresence/database';
export const receiptSelect = {
  id: true,
  paymentId: true,
  accountId: true,
  fileName: true,
  mimeType: true,
  size: true,
  status: true,
  reason: true,
  createdAt: true,
  reviewedAt: true,
  reviewedBy: true,
} as const;
export function presentReceipt(row: Pick<PaymentReceipt, keyof typeof receiptSelect>) {
  return {
    id: row.id,
    paymentId: row.paymentId,
    accountId: row.accountId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: row.size,
    status: row.status,
    reason: row.reason,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy,
    fileAvailable: !row.reviewedAt || row.reviewedAt.getTime() >= Date.now() - 180 * 86400_000,
  };
}
