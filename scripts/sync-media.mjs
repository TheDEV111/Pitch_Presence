import { mkdir, readFile, writeFile } from 'node:fs/promises';
const folder = new URL('../apps/web/public/media/', import.meta.url);
const { assets } = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8'));
await mkdir(folder, { recursive: true });
for (const asset of assets) {
  for (const width of [320, 640, 960, 1440, 1920]) {
    const response = await fetch(`${asset.download}?auto=compress&cs=tinysrgb&fm=webp&w=${width}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/'))
      throw new Error(`Cannot download ${asset.name}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(new URL(`${asset.name}-${width}.webp`, folder), bytes);
    console.log(`${asset.name} ${width}px: ${Math.round(bytes.length / 1024)}KB`);
  }
}
const fontFolder = new URL('../apps/web/public/fonts/', import.meta.url);
await mkdir(fontFolder, { recursive: true });
for (const [name, source] of [
  [
    'Antonio.ttf',
    'https://raw.githubusercontent.com/google/fonts/main/ofl/antonio/Antonio%5Bwght%5D.ttf',
  ],
  ['Antonio-OFL.txt', 'https://raw.githubusercontent.com/google/fonts/main/ofl/antonio/OFL.txt'],
  [
    'Inter.ttf',
    'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf',
  ],
  ['Inter-OFL.txt', 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt'],
]) {
  const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Cannot download ${name}: ${response.status}`);
  await writeFile(new URL(name, fontFolder), Buffer.from(await response.arrayBuffer()));
}
console.log(
  'Assets downloaded. Set NEXT_PUBLIC_LOCAL_MEDIA=true and NEXT_PUBLIC_LOCAL_FONTS=true before building.',
);
