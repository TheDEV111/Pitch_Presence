import { readFile, readdir, lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { githubTokenLines, safePath } from './github-tokens.mjs';

async function main() {
  // git ls-files supplies NUL-separated paths. An empty/failed listing fails closed.
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const files = new Set(Buffer.concat(chunks).toString('utf8').split('\0').filter(Boolean));
  if (!files.size) throw new Error('No tracked files received; Git token scan cannot run.');

  if (process.argv.includes('--browser')) {
    async function collect(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await collect(path);
        else files.add(path);
      }
    }
    // Missing production assets are an error, not a successful empty scan.
    await collect('apps/web/.next/static');
    await collect('apps/web/.next/server/app');
    await collect('apps/web/public');
  }
  let matches = 0;
  for (const path of files) {
    const stat = await lstat(path);
    if (stat.isDirectory()) continue;
    const content = stat.isSymbolicLink() ? await readlink(path) : await readFile(path, 'utf8');
    const lines = githubTokenLines(content);
    if (!lines.length) continue;
    matches += lines.length;
    console.error(`GitHub token detected in ${safePath(path)} at line(s): ${lines.join(', ')}.`);
  }
  if (matches) throw new Error('GitHub token scan failed. Remove and revoke exposed credentials.');
  console.log(`GitHub token scan passed: ${files.size} files checked; no token values logged.`);
}

main().catch(() => {
  // Never dump filesystem errors, buffers, or subprocess output containing secrets.
  console.error('GitHub token scan could not pass. Check the file listing and scan results.');
  process.exitCode = 1;
});
