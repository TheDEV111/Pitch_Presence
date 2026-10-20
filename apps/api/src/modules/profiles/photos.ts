import sharp from 'sharp';
import { PROFILE_PHOTO_MAX_BYTES } from '@pitchpresence/shared';
import { AppError, requireRule } from '../../plugins/core.js';
function animationChunks(bytes: Buffer, format?: string) {
  if (format !== 'png' && format !== 'webp') return false;
  let offset = format === 'png' ? 8 : 12;
  while (offset + 8 <= bytes.length) {
    const png = format === 'png';
    const size = png ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset + 4);
    const kind = bytes.toString('ascii', offset + (png ? 4 : 0), offset + (png ? 8 : 4));
    if (kind === 'acTL' || kind === 'ANIM' || kind === 'ANMF') return true;
    offset += size + (png ? 12 : 8 + (size % 2));
  }
  return false;
}
export async function normalizePhoto(content: string, mimeType: string) {
  const bytes = Buffer.from(content, 'base64');
  requireRule(
    bytes.length > 0 &&
      bytes.length <= PROFILE_PHOTO_MAX_BYTES &&
      bytes.toString('base64') === content,
    422,
    'PHOTO_INVALID',
    'Choose a JPEG, PNG or WebP image no larger than 2 MiB.',
  );
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    requireRule(
      ['jpeg', 'png', 'webp'].includes(metadata.format ?? '') &&
        `image/${metadata.format}` === mimeType &&
        (metadata.pages ?? 1) === 1 &&
        !animationChunks(bytes, metadata.format) &&
        metadata.loop === undefined,
      422,
      'PHOTO_INVALID',
      'Use a still JPEG, PNG or WebP image.',
    );
    const output = await image
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'centre' })
      .webp({ quality: 80 })
      .toBuffer();
    requireRule(
      output.length <= 262144,
      422,
      'PHOTO_INVALID',
      'This image is too complex. Choose a simpler photo.',
    );
    return output;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      422,
      'PHOTO_INVALID',
      'The image could not be read. Use a still JPEG, PNG or WebP under 20 megapixels.',
    );
  }
}
