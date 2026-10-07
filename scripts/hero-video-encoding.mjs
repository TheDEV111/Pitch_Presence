import { readFile } from 'node:fs/promises';
import { MediaAcceptanceError, mediaStep } from './media-diagnostics.mjs';
import { probe, run } from './media-tools.mjs';

export const FPS = 24;
export const SCENE_SECONDS = 3;
export const SCENE_FRAMES = FPS * SCENE_SECONDS;
export const FILM_SECONDS = 12;
export const FILM_FRAMES = FPS * FILM_SECONDS;
export const VARIANTS = [
  {
    name: 'desktop',
    width: 1920,
    height: 1080,
    budget: 3000000,
    maxRate: '1900k',
    buffer: '3800k',
  },
  { name: 'mobile', width: 720, height: 900, budget: 1500000, maxRate: '900k', buffer: '1800k' },
];

// Still-image overlays must not promote the output to their default 25fps.
// Use the same MP4 time base for every segment passed to the concat demuxer.
export const NORMALISE_TIMING = 'fps=24,settb=1/24,setpts=N/(24*TB)';
export function sceneFilter(base, footer, overlay) {
  return overlay
    ? `[0:v]${base}[base];[base][1:v]overlay=x=(W-w)/2:y=(H-h)/2+35,${footer},${NORMALISE_TIMING}[out]`
    : `[0:v]${base},${footer},${NORMALISE_TIMING}[out]`;
}
export function timingArgs(frames, { mp4 = true } = {}) {
  return [
    '-frames:v',
    String(frames),
    '-r',
    String(FPS),
    '-fps_mode',
    'cfr',
    ...(mp4 ? ['-video_track_timescale', '24000'] : []),
  ];
}

function finite(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function measurements(info, bytes = null) {
  const video = info.streams?.find((stream) => stream.codec_type === 'video');
  const [numerator, denominator] = String(video?.avg_frame_rate).split('/').map(Number);
  return {
    bytes,
    durationSeconds: finite(info.format?.duration),
    fps: finite(numerator / denominator),
    frames: finite(video?.nb_frames),
    timeBase: /^\d+\/\d+$/.test(video?.time_base) ? video.time_base : null,
  };
}

export function assertSceneTiming(info) {
  const measured = measurements(info);
  if (
    measured.fps !== FPS ||
    measured.frames !== SCENE_FRAMES ||
    measured.durationSeconds === null ||
    Math.abs(measured.durationSeconds - SCENE_SECONDS) > 1 / FPS ||
    measured.timeBase !== '1/24000'
  )
    throw new MediaAcceptanceError(
      `Scene timing failed: ${measured.durationSeconds ?? 'unknown'}s, ${measured.fps ?? 'unknown'}fps, ${measured.frames ?? 'unknown'} frames, time base ${measured.timeBase ?? 'unknown'}; expected 3s, 24fps, 72 frames and time base 1/24000.`,
      { ...measured, expectedSeconds: SCENE_SECONDS, expectedFrames: SCENE_FRAMES },
    );
}

export function assertFilmTiming(measured) {
  if (
    measured.durationSeconds === null ||
    Math.abs(measured.durationSeconds - FILM_SECONDS) > 0.15 ||
    measured.fps !== FPS ||
    measured.frames !== FILM_FRAMES
  )
    throw new MediaAcceptanceError(
      `Film timing failed: ${measured.durationSeconds ?? 'unknown'}s, ${measured.fps ?? 'unknown'}fps, ${measured.frames ?? 'unknown'} frames; expected 12s, 24fps, 288 frames.`,
      { ...measured, expectedSeconds: FILM_SECONDS, expectedFrames: FILM_FRAMES },
    );
}

// Leave 15% for MP4 overhead and short-video bitrate variation.
export function targetBitrate(budget) {
  return Math.floor((budget * 8 * 0.85) / FILM_SECONDS);
}

export async function finishFilm(
  { variant, concatFile, output, passLog },
  {
    execute = run,
    inspect = probe,
    readOutput = readFile,
    step = mediaStep,
    log = console.log,
  } = {},
) {
  await step(`Joining ${variant.name} scenes`, () =>
    execute('ffmpeg', [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatFile,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      output,
    ]),
  );
  let info;
  let bytes;
  async function inspectExport() {
    info = await step(`Inspecting ${variant.name} export`, () => inspect(output));
    bytes = await readOutput(output);
    const measured = measurements(info, bytes.length);
    log(
      `Film ${variant.name}: ${measured.bytes} bytes (limit ${variant.budget}), ${measured.durationSeconds ?? 'unknown'}s (target 12), ${measured.fps ?? 'unknown'}fps, ${measured.frames ?? 'unknown'} frames.`,
    );
    await step(`Validating ${variant.name} export timing`, async () => assertFilmTiming(measured));
    return measured;
  }
  let measured = await inspectExport();
  if (measured.bytes > variant.budget) {
    const bitrate = targetBitrate(variant.budget);
    log(`Compressing ${variant.name} export in two passes at ${bitrate} bits/sec.`);
    const common = [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatFile,
      '-map',
      '0:v:0',
      '-vf',
      NORMALISE_TIMING,
      ...timingArgs(FILM_FRAMES, { mp4: false }),
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-b:v',
      String(bitrate),
      '-pix_fmt',
      'yuv420p',
      '-passlogfile',
      passLog,
    ];
    await step(`Analysing ${variant.name} compression`, () =>
      execute('ffmpeg', [...common, '-pass', '1', '-f', 'null', '/dev/null']),
    );
    await step(`Compressing ${variant.name} export`, () =>
      execute('ffmpeg', [
        ...common,
        '-pass',
        '2',
        '-video_track_timescale',
        '24000',
        '-movflags',
        '+faststart',
        output,
      ]),
    );
    measured = await inspectExport();
  }
  await step(`Validating ${variant.name} export size`, async () => {
    if (measured.bytes > variant.budget)
      throw new MediaAcceptanceError(
        `Film ${variant.name} exceeds its size budget: ${measured.bytes} bytes; limit ${variant.budget} bytes.`,
        { ...measured, bytesLimit: variant.budget },
      );
  });
  return { info, bytes };
}
