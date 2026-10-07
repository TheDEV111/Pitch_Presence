import { readFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
const folder = new URL('../apps/web/public/icons/', import.meta.url);
const source = await readFile(new URL('../apps/web/public/icon.svg', import.meta.url));
await mkdir(folder, { recursive: true });
for (const [name, size] of [
  ['icon-192', 192],
  ['icon-512', 512],
  ['apple-touch-icon', 180],
]) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(new URL(`${name}.png`, folder).pathname);
}
const mark = await sharp(source).resize(300, 300).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 3, background: '#195c3c' } })
  .composite([{ input: mark, left: 106, top: 106 }])
  .png()
  .toFile(new URL('maskable-512.png', folder).pathname);
console.log('Generated installation icons from the existing brand mark.');
