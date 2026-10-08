import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { RECEIPT_MAX_BYTES } from '@pitchpresence/shared';
import { requireRule } from '../../plugins/core.js';

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(bytes: Buffer) {
  requireRule(
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
    422,
    'RECEIPT_INVALID',
    'Upload a valid PNG image.',
  );
  let offset = 8;
  let width = 0,
    height = 0,
    channels = 0,
    depth = 0;
  let ended = false;
  const data: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    requireRule(
      size <= bytes.length - offset - 12,
      422,
      'RECEIPT_INVALID',
      'The PNG file is incomplete.',
    );
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + size);
    requireRule(
      crc32(bytes.subarray(offset + 4, offset + 8 + size)) ===
        bytes.readUInt32BE(offset + 8 + size),
      422,
      'RECEIPT_INVALID',
      'The PNG file is damaged.',
    );
    if (offset === 8) {
      requireRule(
        type === 'IHDR' && size === 13,
        422,
        'RECEIPT_INVALID',
        'The PNG header is invalid.',
      );
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      const color = body[9]!;
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color] ?? 0;
      const validDepth = color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
      requireRule(
        width > 0 &&
          height > 0 &&
          width * height <= 8_000_000 &&
          channels &&
          validDepth.includes(depth) &&
          body[10] === 0 &&
          body[11] === 0 &&
          body[12] === 0,
        422,
        'RECEIPT_INVALID',
        'Use a non-interlaced PNG up to 8 megapixels.',
      );
    } else requireRule(type !== 'IHDR', 422, 'RECEIPT_INVALID', 'The PNG header is duplicated.');
    if (type === 'IDAT') data.push(body);
    offset += size + 12;
    if (type === 'IEND') {
      ended = size === 0 && offset === bytes.length;
      break;
    }
  }
  requireRule(ended && data.length, 422, 'RECEIPT_INVALID', 'The PNG file is incomplete.');
  const row = Math.ceil((width * channels * depth) / 8) + 1;
  const expected = row * height;
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(data), { maxOutputLength: expected });
  } catch {
    requireRule(false, 422, 'RECEIPT_INVALID', 'The PNG image could not be read.');
  }
  requireRule(pixels!.length === expected, 422, 'RECEIPT_INVALID', 'The PNG image is incomplete.');
  for (let y = 0; y < height; y++)
    requireRule(
      pixels![y * row]! <= 4,
      422,
      'RECEIPT_INVALID',
      'The PNG image has invalid scanlines.',
    );
}
export function receiptFile(content: string, mimeType: string, fileName: string) {
  const bytes = Buffer.from(content, 'base64');
  requireRule(
    bytes.length > 0 && bytes.length <= RECEIPT_MAX_BYTES && bytes.toString('base64') === content,
    422,
    'RECEIPT_SIZE',
    'Upload a PDF or PNG up to 2 MB.',
  );
  if (mimeType === 'image/png') {
    requireRule(
      /\.png$/i.test(fileName),
      422,
      'RECEIPT_INVALID',
      'Use a .png filename for a PNG image.',
    );
    png(bytes);
  } else {
    requireRule(
      /\.pdf$/i.test(fileName) &&
        /^%PDF-1\.[0-7]|^%PDF-2\.0/.test(bytes.toString('ascii', 0, 8)) &&
        /%%EOF\s*$/.test(bytes.subarray(-1024).toString('ascii')),
      422,
      'RECEIPT_INVALID',
      'Upload a complete PDF document.',
    );
  }
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
