import { afterEach, expect, it, vi } from 'vitest';
import { failureReport, mediaStep, MediaToolError } from './media-diagnostics.mjs';
import { run } from './media-tools.mjs';

afterEach(() => vi.restoreAllMocks());

it('reports the specific failed stage and keeps raw browser URLs out of diagnostics', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const raw = new Error(
    'page.goto: net::ERR_CONNECTION_REFUSED at https://example.com/?token=PRIVATE_TEST_VALUE',
  );
  const error = await mediaStep('Capturing the walkthrough', () =>
    mediaStep('Opening the landing page', () => Promise.reject(raw)),
  ).catch((error) => error);
  expect(failureReport(error)).toEqual({
    stage: 'Opening the landing page',
    message: 'The preview server could not be reached.',
  });
  expect(JSON.stringify(failureReport(error))).not.toContain('PRIVATE_TEST_VALUE');
});

it('summarizes missing Chromium and scene timeouts without printing browser buffers', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  for (const [raw, expected] of [
    ["Executable doesn't exist at /private/path", 'Chromium is unavailable.'],
    [
      'locator.waitFor: Timeout 30000ms exceeded. PRIVATE_TEST_VALUE',
      'The browser operation timed out.',
    ],
  ]) {
    const error = await mediaStep('Capturing demo scene 2', () =>
      Promise.reject(new Error(raw)),
    ).catch((error) => error);
    expect(failureReport(error).message).toContain(expected);
    expect(JSON.stringify(failureReport(error))).not.toContain('PRIVATE_TEST_VALUE');
    expect(JSON.stringify(failureReport(error))).not.toContain('/private/path');
  }
});

it('classifies FFmpeg failures and excludes arbitrary subprocess stderr from the report', () => {
  for (const [stderr, summary] of [
    ["No such filter: 'drawtext'", 'does not provide the drawtext filter'],
    ["Unknown encoder 'libx264'", 'does not provide the libx264 encoder'],
    ['Failed to configure output pad: Resource temporarily unavailable', 'memory or threads'],
    ['No such file or directory', 'input or font could not be opened'],
    ['moov atom not found', 'not a readable media file'],
    ['Unclassified failure', 'Check the inputs and installed codecs'],
  ]) {
    const error = new MediaToolError('ffmpeg', 1, `${stderr}\nPRIVATE_TEST_VALUE`);
    expect(failureReport(error).message).toContain(summary);
    expect(failureReport(error).message).toContain('exit 1');
    expect(JSON.stringify(failureReport(error))).not.toContain('PRIVATE_TEST_VALUE');
  }
});

it('preserves missing input and known master errors while hiding unexpected exception details', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  for (const [raw, expected] of [
    [
      Object.assign(new Error('/private/input'), { code: 'ENOENT' }),
      'A required local input file is missing.',
    ],
    [
      new Error('Invalid or undersized video master: warmup.'),
      'Invalid or undersized video master: warmup.',
    ],
    [
      new Error('Unexpected PRIVATE_TEST_VALUE'),
      'Unexpected media failure. Check the inputs for this stage.',
    ],
  ]) {
    const error = await mediaStep('Preparing video master 1', () => Promise.reject(raw)).catch(
      (error) => error,
    );
    expect(failureReport(error).message).toBe(expected);
  }
});

it('returns successful tool output and converts a real nonzero process exit into a safe summary', async () => {
  await expect(run('/bin/sh', ['-c', 'printf ok'])).resolves.toBe('ok');
  const error = await run('/bin/sh', [
    '-c',
    'echo "Resource temporarily unavailable PRIVATE_TEST_VALUE" >&2; exit 7',
  ]).catch((error) => error);
  expect(error).toBeInstanceOf(MediaToolError);
  expect(error.exitCode).toBe(7);
  expect(error.message).toContain('memory or threads');
  expect(error.message).not.toContain('PRIVATE_TEST_VALUE');
});
