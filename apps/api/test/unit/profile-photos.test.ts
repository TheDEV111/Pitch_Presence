import { expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizePhoto } from '../../src/modules/profiles/photos.js';
it('rejects animated WebP rather than silently extracting its first frame', async () => {
  const raw = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]);
  const animated = await sharp(raw, { raw: { width: 1, height: 2, channels: 4, pageHeight: 1 } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  expect((await sharp(animated).metadata()).pages).toBe(2);
  await expect(normalizePhoto(animated.toString('base64'), 'image/webp')).rejects.toMatchObject({
    code: 'PHOTO_INVALID',
  });
});
it('rejects MIME spoofing, corrupt base64, excessive bytes and decompression bombs', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } })
    .png()
    .toBuffer();
  await expect(normalizePhoto(png.toString('base64'), 'image/jpeg')).rejects.toMatchObject({
    code: 'PHOTO_INVALID',
  });
  await expect(normalizePhoto('@@@=', 'image/png')).rejects.toMatchObject({
    code: 'PHOTO_INVALID',
  });
  await expect(
    normalizePhoto(Buffer.alloc(2097153).toString('base64'), 'image/png'),
  ).rejects.toMatchObject({ code: 'PHOTO_INVALID' });
  const large = await sharp({
    create: { width: 5000, height: 4100, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  await expect(normalizePhoto(large.toString('base64'), 'image/png')).rejects.toMatchObject({
    code: 'PHOTO_INVALID',
  });
  const webp = await normalizePhoto(png.toString('base64'), 'image/png');
  expect((await sharp(webp).metadata()).format).toBe('webp');
});
