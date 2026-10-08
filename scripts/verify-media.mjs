import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { publicFolder, probe, digest } from './media-tools.mjs';
import { FILM_SECONDS } from './hero-video-encoding.mjs';

async function main() {
  const icons = [
    ['icon-192', 192],
    ['icon-512', 512],
    ['maskable-512', 512],
    ['apple-touch-icon', 180],
  ];
  for (const [name, size] of icons) {
    const image = await sharp(join(publicFolder, 'icons', `${name}.png`)).metadata();
    if (image.format !== 'png' || image.width !== size || image.height !== size)
      throw new Error(`Invalid install icon: ${name}.`);
  }
  if (process.argv.includes('--icons-only')) {
    console.log('Installation icons verified.');
    return;
  }
  const folder = join(publicFolder, 'media');
  const register = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  for (const asset of register.assets) {
    for (const width of [320, 640, 960, 1440, 1920]) {
      const name = `${asset.name}-${width}.webp`;
      const bytes = await readFile(join(folder, name));
      const metadata = await sharp(bytes).metadata();
      const recorded = asset.outputs?.find((output) => output.file === name);
      if (
        metadata.format !== 'webp' ||
        metadata.width !== width ||
        bytes.length > (width <= 640 ? 250000 : 500000) ||
        recorded?.sha256 !== digest(bytes)
      )
        throw new Error(`Image not ready: ${name}.`);
    }
  }
  for (const name of ['Antonio', 'Inter']) {
    const bytes = await readFile(join(publicFolder, 'fonts', `${name}.woff2`));
    const registered = register.fonts?.find((font) => font.name === name);
    if (
      bytes.subarray(0, 4).toString() !== 'wOF2' ||
      bytes.length > 180000 ||
      registered?.sha256 !== digest(bytes)
    )
      throw new Error(`Font not ready: ${name}.`);
    const license = await readFile(join(publicFolder, 'fonts', `${name}-OFL.txt`), 'utf8');
    if (!license.includes('SIL OPEN FONT LICENSE'))
      throw new Error(`Missing font licence: ${name}.`);
  }
  const film = JSON.parse(await readFile(join(folder, 'film.json'), 'utf8'));
  if (!film.ready) throw new Error('Film has not been rendered.');
  if (register.film?.composition !== 'original-football-footage-clean')
    throw new Error('Film has not been rebuilt from the clean football recipe.');
  if (film.duration !== FILM_SECONDS || register.film?.duration !== FILM_SECONDS)
    throw new Error('Film duration metadata does not match the current recipe.');
  for (const [variant, width, height, budget] of [
    ['desktop', 1920, 1080, 3000000],
    ['mobile', 720, 900, 1500000],
  ]) {
    const name = `hero-${variant}.mp4`;
    const bytes = await readFile(join(folder, name));
    const recorded = register.film?.outputs.find((output) => output.file === name);
    const info = process.argv.includes('--recorded-only')
      ? {
          streams: [
            {
              codec_type: 'video',
              codec_name: recorded?.codec,
              pix_fmt: 'yuv420p',
              width: recorded?.width,
              height: recorded?.height,
              avg_frame_rate: `${recorded?.fps}/1`,
            },
          ],
          format: { duration: recorded?.duration },
        }
      : await probe(join(folder, name));
    const stream = info.streams.find((stream) => stream.codec_type === 'video');
    if (
      !stream ||
      stream.codec_name !== 'h264' ||
      stream.pix_fmt !== 'yuv420p' ||
      stream.width !== width ||
      stream.height !== height ||
      stream.avg_frame_rate !== '24/1' ||
      recorded?.audio !== false ||
      info.streams.some((stream) => stream.codec_type === 'audio') ||
      !Number.isFinite(Number(info.format.duration)) ||
      Math.abs(Number(info.format.duration) - FILM_SECONDS) > 0.15 ||
      bytes.length > budget ||
      recorded?.sha256 !== digest(bytes)
    )
      throw new Error(`Film not ready: ${variant}.`);
    const posterBytes = await readFile(join(folder, `hero-${variant}-poster.webp`));
    const poster = await sharp(posterBytes).metadata();
    if (
      poster.format !== 'webp' ||
      poster.width !== width ||
      poster.height !== height ||
      posterBytes.length > (variant === 'mobile' ? 250000 : 500000)
    )
      throw new Error(`Poster not ready: ${variant}.`);
  }
  console.log('Media release acceptance passed: icons, images, fonts, film and posters.');
}
main().catch((error) => {
  console.error(
    `Media verification failed: ${error.code === 'ENOENT' ? 'Required local asset missing. Run the media pipeline before release.' : error.message}`,
  );
  process.exitCode = 1;
});
