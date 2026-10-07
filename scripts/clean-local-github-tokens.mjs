import { readFile, lstat, writeFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  githubTokenLines,
  safePath,
  cleanGithubCredentialUrls,
  removeGithubTokenLines,
} from './github-tokens.mjs';

async function main() {
  const apply = process.argv.includes('--apply');
  const targets = [
    { path: '.git/config', clean: cleanGithubCredentialUrls },
    { path: join(homedir(), '.git-credentials'), clean: removeGithubTokenLines },
    { path: join(homedir(), '.config/git/credentials'), clean: removeGithubTokenLines },
    { path: join(homedir(), '.bash_history'), clean: removeGithubTokenLines },
    { path: join(homedir(), '.zsh_history'), clean: removeGithubTokenLines },
  ];
  let blocked = false;
  for (const { path, clean } of targets) {
    let content, mode;
    try {
      const details = await lstat(path);
      if (!details.isFile()) throw new Error('Not a regular file');
      mode = details.mode & 0o777;
      content = await readFile(path, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      console.error(`Cannot inspect ${safePath(path)}.`);
      blocked = true;
      continue;
    }
    const cleaned = clean(content);
    if (cleaned === content) {
      console.log(`No cleanup needed: ${safePath(path)}.`);
      continue;
    }
    const count = githubTokenLines(content).length;
    if (!apply) {
      console.log(`Would clean ${safePath(path)} (${count} token-bearing lines).`);
      continue;
    }
    const temporary = `${path}.clean-${randomUUID()}`;
    try {
      // Write only sanitized content; never create a backup containing the token.
      await writeFile(temporary, cleaned, { flag: 'wx', mode });
      await rename(temporary, path);
      console.log(`Cleaned ${safePath(path)} (${count} token-bearing lines).`);
    } catch {
      console.error(`Cannot write ${safePath(path)}. Run locally with access to this file.`);
      blocked = true;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  if (!apply) console.log('Preview only. Run again with --apply to clean these local files.');
  if (blocked) process.exitCode = 1;
}

main().catch(() => {
  console.error('Local cleanup could not complete. No token values were logged.');
  process.exitCode = 1;
});
