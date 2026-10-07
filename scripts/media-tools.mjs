import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const publicFolder = join(root, 'apps/web/public');
export const sourceFolder = join(root, '.media-source');
export const workFolder = join(root, '.media-work');
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    // Tool failures are summarized; do not dump source URLs or arbitrary subprocess buffers.
    child.stderr.resume();
    child.on('error', () =>
      reject(new Error(`${command} is unavailable. Install the documented media tools.`)),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`${command} failed. Check the inputs and installed codecs.`)),
    );
  });
}
export async function download(url, path) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  } catch {
    throw new Error(
      'Media download unavailable. Use a network-enabled machine or the media workflow.',
    );
  }
  if (!response.ok)
    throw new Error(
      `Media download failed (${response.status}). Supply the licensed master locally if the provider blocks automated downloads.`,
    );
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path, bytes);
  return bytes;
}
export async function localMaster(name, url) {
  await mkdir(sourceFolder, { recursive: true });
  const path = join(sourceFolder, name);
  try {
    return await readFile(path);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return download(url, path);
  }
}
export async function probe(path) {
  return JSON.parse(
    await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]),
  );
}
