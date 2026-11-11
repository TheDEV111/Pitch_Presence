import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each([
  ['staging', 1],
  ['main', 0],
  ['feature/example', 0],
  ['', 0],
])('only permits the staging Git branch to build (%s)', (branch, expected) => {
  const result = spawnSync(process.execPath, ['scripts/vercel-staging-ignore.mjs'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VERCEL_GIT_COMMIT_REF: branch },
    encoding: 'utf8',
  });
  expect(result.status).toBe(expected);
});
