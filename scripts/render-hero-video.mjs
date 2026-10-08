import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadVideoMaster } from './video-master.mjs';
import { sourceFolder, publicFolder, workFolder, digest, probe, run } from './media-tools.mjs';
import { mediaStep, failureReport, MediaAcceptanceError } from './media-diagnostics.mjs';
import {
  VARIANTS,
  FILM_SECONDS,
  SCENE_SECONDS,
  SCENE_FRAMES,
  sceneFilter,
  timingArgs,
  assertSceneTiming,
  finishFilm,
} from './hero-video-encoding.mjs';

async function main() {
  await mkdir(sourceFolder, { recursive: true });
  await mkdir(workFolder, { recursive: true });
  await rm(join(workFolder, 'render-failure.json'), { force: true });
  const folder = join(publicFolder, 'media');
  const register = await mediaStep('Reading the asset register', async () =>
    JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')),
  );
  await mediaStep('Checking FFmpeg', () => run('ffmpeg', ['-version']));
  await mediaStep('Checking FFprobe', () => run('ffprobe', ['-version']));
  const scenes = [
    { source: 'warmup', offset: 0 },
    { source: 'coaching', offset: 0 },
    { source: 'warmup', offset: 3 },
    { source: 'coaching', offset: 3 },
    { source: 'coaching', offset: 6 },
  ];
  const assets = new Map();
  const masters = new Map();
  for (const name of new Set(scenes.map((scene) => scene.source))) {
    const asset = register.videos?.find((video) => video.name === name);
    await mediaStep(`Checking ${name} source registration`, async () => {
      if (!asset)
        throw new MediaAcceptanceError(
          'A required original football source is not registered.',
          {},
        );
    });
    assets.set(name, asset);
    masters.set(
      name,
      await mediaStep(`Preparing ${name} video master`, () => loadVideoMaster(asset)),
    );
  }
  const outputs = [];
  for (const spec of VARIANTS) {
    const { name: variant, width, height } = spec;
    const clips = [];
    for (const [index, scene] of scenes.entries()) {
      const asset = assets.get(scene.source);
      const start = asset.trimStart + scene.offset;
      await mediaStep(`Checking ${variant} scene ${index + 1} source duration`, async () => {
        if (asset.duration < start + SCENE_SECONDS)
          throw new MediaAcceptanceError('The original footage is too short for this segment.', {
            durationSeconds: asset.duration,
            requiredSeconds: start + SCENE_SECONDS,
          });
      });
      const clip = join(workFolder, `${variant}-scene-${index + 1}.mp4`);
      // Only scale, crop and normalise timing. No text, panels or overlay image inputs.
      const filter = sceneFilter(
        `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`,
      );
      await mediaStep(`Encoding ${variant} scene ${index + 1}`, () =>
        run('ffmpeg', [
          '-y',
          '-ss',
          String(start),
          '-i',
          masters.get(scene.source),
          '-filter_complex',
          filter,
          '-map',
          '[out]',
          ...timingArgs(SCENE_FRAMES),
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'medium',
          '-crf',
          '26',
          '-maxrate',
          spec.maxRate,
          '-bufsize',
          spec.buffer,
          '-pix_fmt',
          'yuv420p',
          clip,
        ]),
      );
      await mediaStep(`Validating ${variant} scene ${index + 1} timing`, async () =>
        assertSceneTiming(await probe(clip)),
      );
      clips.push(clip);
    }
    const list = join(workFolder, `${variant}-concat.txt`);
    await writeFile(
      list,
      clips
        .map((path) => `file '${path.replaceAll("'", "'\\''")}'\nduration ${SCENE_SECONDS}`)
        .join('\n') + '\n',
    );
    const file = `hero-${variant}.mp4`;
    const output = join(folder, file);
    const { info: metadata, bytes } = await finishFilm({
      variant: spec,
      concatFile: list,
      output,
      passLog: join(workFolder, `${variant}-two-pass`),
    });
    const poster = join(workFolder, `${variant}-poster.png`);
    await mediaStep(`Extracting ${variant} poster`, () =>
      run('ffmpeg', ['-y', '-i', output, '-frames:v', '1', poster]),
    );
    await mediaStep(`Finishing ${variant} poster`, () =>
      sharp(poster)
        .webp({ quality: 76 })
        .toFile(join(folder, `hero-${variant}-poster.webp`)),
    );
    outputs.push({
      file,
      width,
      height,
      bytes: bytes.length,
      sha256: digest(bytes),
      duration: Number(metadata.format.duration),
      fps: 24,
      codec: 'h264',
      audio: false,
    });
    console.log(`${file}: ${Math.ceil(bytes.length / 1000)}KB`);
  }
  register.film = {
    composition: 'original-football-footage-clean',
    duration: FILM_SECONDS,
    outputs,
    recipe: 'scripts/render-hero-video.mjs',
    scenes: scenes.map((scene) => ({ ...scene, duration: SCENE_SECONDS })),
  };
  await writeFile(join(folder, 'manifest.json'), JSON.stringify(register, null, 2) + '\n');
  const filmPath = join(folder, 'film.json');
  const film = JSON.parse(await readFile(filmPath, 'utf8'));
  await writeFile(
    filmPath,
    JSON.stringify(
      {
        ...film,
        ready: true,
        duration: FILM_SECONDS,
        description: 'Football players warming up and a coach leading training.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Film exports ready. Run media:verify and rebuild the frontend.');
}
main().catch(async (error) => {
  const report = failureReport(error);
  console.error(`Film failed at: ${report.stage}. ${report.message}`);
  try {
    await mkdir(workFolder, { recursive: true });
    await writeFile(
      join(workFolder, 'render-failure.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  } catch {
    console.error('The renderer could not write its diagnostic report.');
  }
  console.error('See docs/frontend/pwa-media.md for media setup and recovery.');
  process.exitCode = 1;
});
