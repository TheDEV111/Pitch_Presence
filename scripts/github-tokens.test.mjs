import { expect, it } from 'vitest';
import {
  githubTokenLines,
  safePath,
  cleanGithubCredentialUrls,
  removeGithubTokenLines,
} from './github-tokens.mjs';

// Construct synthetic examples so test source never contains a token-shaped literal.
const classic = ['ghp_', 'a'.repeat(36)].join('');
const fineGrained = ['github_pat_', 'b'.repeat(82)].join('');

it('detects token formats while returning only line numbers', () => {
  for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_']) {
    const token = prefix + 'x'.repeat(40);
    expect(githubTokenLines(`ordinary text\n${token}\n`)).toEqual([2]);
  }
  expect(githubTokenLines('ghp_short\ngithub_pat_placeholder')).toEqual([]);
  expect(safePath(`logs/${classic}.log`)).toBe('logs/[REDACTED].log');
});

it('removes credentials from GitHub remotes while preserving repository paths and other remotes', () => {
  const config = `[remote "origin"]\n url = https://${classic}@github.com/TheDEV111/Pitch_Presence.git\n`;
  expect(cleanGithubCredentialUrls(config)).toBe(
    '[remote "origin"]\n url = https://github.com/TheDEV111/Pitch_Presence.git\n',
  );
  expect(cleanGithubCredentialUrls(`https://user:${fineGrained}@github.com/team/repo.git`)).toBe(
    'https://github.com/team/repo.git',
  );
  expect(cleanGithubCredentialUrls(`https://${classic}@github.com`)).toBe('https://github.com');
  const other = `https://${classic}@example.com/repo.git`;
  expect(cleanGithubCredentialUrls(other)).toBe(other);
});

it('removes only token-bearing history or credential entries without creating secret backups', () => {
  const content = `git status\ngit push https://${classic}@github.com/team/repo.git\nmake start\n${fineGrained}\n`;
  expect(removeGithubTokenLines(content)).toBe('git status\nmake start\n');
  expect(removeGithubTokenLines(`keep this\n${classic}`)).toBe('keep this\n');
  expect(removeGithubTokenLines('keep this')).toBe('keep this');
});
