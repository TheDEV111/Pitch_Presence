import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { receiptFile } from '../../src/modules/receipts/files.js';
import { RECEIPT_MAX_BYTES } from '@pitchpresence/shared';
it('accepts a complete PNG and rejects damage or type spoofing', async () => {
  const png = await readFile('apps/web/public/icons/icon-192.png');
  expect(receiptFile(png.toString('base64'), 'image/png', 'receipt.png').bytes).toEqual(png);
  const damaged = Buffer.from(png);
  damaged[damaged.length - 1]! ^= 1;
  expect(() => receiptFile(damaged.toString('base64'), 'image/png', 'receipt.png')).toThrow();
  expect(() => receiptFile(png.toString('base64'), 'application/pdf', 'receipt.pdf')).toThrow();
  expect(() => receiptFile(png.toString('base64'), 'image/png', 'receipt.pdf')).toThrow();
});
it('bounds decoded file size and rejects incomplete documents', () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n');
  expect(receiptFile(pdf.toString('base64'), 'application/pdf', 'receipt.pdf').bytes).toEqual(pdf);
  expect(() =>
    receiptFile(
      Buffer.from('%PDF-1.7\nincomplete').toString('base64'),
      'application/pdf',
      'receipt.pdf',
    ),
  ).toThrow();
  const big = Buffer.alloc(RECEIPT_MAX_BYTES + 1, 0x20);
  pdf.copy(big);
  Buffer.from('%%EOF').copy(big, big.length - 5);
  expect(() => receiptFile(big.toString('base64'), 'application/pdf', 'receipt.pdf')).toThrow(
    'up to 2 MB',
  );
});
