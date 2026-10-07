import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { serviceWorkerSource } from './pwa-worker.mjs';
import { run } from './media-tools.mjs';
const web = fileURLToPath(new URL('../apps/web/', import.meta.url));
if (process.env.REQUIRE_LOCAL_MEDIA === 'true') {
  if (process.env.NEXT_PUBLIC_LOCAL_FONTS !== 'true')
    throw new Error('Release builds require NEXT_PUBLIC_LOCAL_FONTS=true.');
  await run('node', ['scripts/verify-media.mjs', '--recorded-only']);
}
const buildId = await readFile(join(web, '.next/BUILD_ID'), 'utf8');
const assets = [];
async function collect(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path, prefix);
    else if (/\.(js|css|woff2?|png)$/.test(entry.name))
      assets.push(prefix + relative(join(web, '.next/static'), path).replaceAll('\\', '/'));
  }
}
await collect(join(web, '.next/static'), '/_next/static/');
const version = createHash('sha256')
  .update(buildId)
  .update(serviceWorkerSource({ version: '', staticAssets: assets }))
  .digest('hex')
  .slice(0, 16);
await writeFile(join(web, 'public/sw.js'), serviceWorkerSource({ version, staticAssets: assets }));
console.log(`PWA worker generated for build ${version}; ${assets.length} approved static paths.`);
