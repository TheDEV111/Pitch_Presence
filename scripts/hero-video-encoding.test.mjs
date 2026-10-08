import { afterEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSceneTiming,
  finishFilm,
  sceneFilter,
  timingArgs,
  VARIANTS,
} from './hero-video-encoding.mjs';
import { failureReport, mediaStep } from './media-diagnostics.mjs';
import { probe, run } from './media-tools.mjs';

const folders = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});
function info({ duration = '15', fps = '24/1', frames = '360', timeBase = '1/24000' } = {}) {
  return {
    format: { duration },
    streams: [{ codec_type: 'video', avg_frame_rate: fps, nb_frames: frames, time_base: timeBase }],
  };
}
function fixture() {
  return {
    options: {
      variant: VARIANTS[0],
      concatFile: 'scenes.txt',
      output: 'film.mp4',
      passLog: 'desktop-pass',
    },
    deps: {
      execute: vi.fn().mockResolvedValue(''),
      inspect: vi.fn().mockResolvedValue(info()),
      readOutput: vi.fn().mockResolvedValue(Buffer.alloc(2000000)),
      step: (_stage, action) => action(),
      log: vi.fn(),
    },
  };
}

it('keeps a correctly timed export already within budget without recompression', async () => {
  const f = fixture();
  const result = await finishFilm(f.options, f.deps);
  expect(result.bytes.length).toBe(2000000);
  expect(f.deps.execute).toHaveBeenCalledTimes(1);
});

it('recompresses an oversized film in two passes and inspects the replacement', async () => {
  const f = fixture();
  f.deps.readOutput
    .mockResolvedValueOnce(Buffer.alloc(4000000))
    .mockResolvedValueOnce(Buffer.alloc(2700000));
  const result = await finishFilm(f.options, f.deps);
  expect(result.bytes.length).toBe(2700000);
  expect(f.deps.inspect).toHaveBeenCalledTimes(2);
  const analysis = f.deps.execute.mock.calls[1][1];
  const compression = f.deps.execute.mock.calls[2][1];
  expect(analysis[analysis.indexOf('-pass') + 1]).toBe('1');
  expect(compression[compression.indexOf('-pass') + 1]).toBe('2');
  expect(compression[compression.indexOf('-b:v') + 1]).toBe('1360000');
  expect(compression[compression.indexOf('-passlogfile') + 1]).toBe('desktop-pass');
  expect(compression.at(-1)).toBe('film.mp4');
  expect(compression).not.toContain('-crf');
});

it('retains the size limit after compression and includes actual bytes in the failure report', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const f = fixture();
  f.deps.readOutput.mockResolvedValue(Buffer.alloc(3100000));
  f.deps.step = mediaStep;
  const error = await finishFilm(f.options, f.deps).catch((error) => error);
  expect(failureReport(error)).toMatchObject({
    stage: 'Validating desktop export size',
    measurements: { bytes: 3100000, bytesLimit: 3000000, durationSeconds: 15 },
  });
  expect(error.message).toContain('3100000 bytes');
});

it('rejects duration drift, wrong frame rates and incomplete exports before accepting them', async () => {
  for (const metadata of [
    info({ duration: '15.48' }),
    info({ fps: '25/1' }),
    info({ frames: '280' }),
    info({ duration: 'N/A' }),
  ]) {
    const f = fixture();
    f.deps.inspect.mockResolvedValue(metadata);
    await expect(finishFilm(f.options, f.deps)).rejects.toThrow('Film timing failed');
    expect(f.deps.execute).toHaveBeenCalledTimes(1);
  }
});

it('rejects segments whose clock would drift during stream-copy concatenation', () => {
  expect(() => assertSceneTiming(info({ duration: '3', frames: '72' }))).not.toThrow();
  for (const metadata of [
    info({ duration: '3', frames: '75', fps: '25/1' }),
    info({ duration: '3', frames: '72', timeBase: '1/12800' }),
  ])
    expect(() => assertSceneTiming(metadata)).toThrow('Scene timing failed');
});

const ffmpegAvailable =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 3000 }).status === 0;
it.skipIf(!ffmpegAvailable)(
  'encodes mixed-rate football footage into a fifteen-second film within budget',
  async () => {
    const folder = await mkdtemp(join(tmpdir(), 'pitch-film-'));
    folders.push(folder);
    const clips = [];
    for (let scene = 0; scene < 5; scene++) {
      const output = join(folder, `scene-${scene}.mp4`);
      const args = [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=320x180:rate=${scene === 1 ? 25 : 24}`,
      ];
      args.push(
        '-filter_complex',
        sceneFilter('null'),
        '-map',
        '[out]',
        ...timingArgs(72),
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '10',
        '-pix_fmt',
        'yuv420p',
        output,
      );
      await run('ffmpeg', args);
      assertSceneTiming(await probe(output));
      clips.push(output);
    }
    const concatFile = join(folder, 'scenes.txt');
    await writeFile(
      concatFile,
      clips.map((path) => `file '${path}'\nduration 3`).join('\n') + '\n',
    );
    const result = await finishFilm(
      {
        variant: { name: 'desktop', budget: 150000 },
        concatFile,
        output: join(folder, 'film.mp4'),
        passLog: join(folder, 'pass'),
      },
      { log: () => {}, step: (_stage, action) => action() },
    );
    expect(result.bytes.length).toBeLessThanOrEqual(150000);
    expect(result.info.streams.find((stream) => stream.codec_type === 'video')).toMatchObject({
      codec_name: 'h264',
      pix_fmt: 'yuv420p',
      avg_frame_rate: '24/1',
      nb_frames: '360',
    });
    expect(Number(result.info.format.duration)).toBeCloseTo(15, 2);
  },
);
