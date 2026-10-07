import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { chromium } from '@playwright/test';
import { loadVideoMaster } from './video-master.mjs';
import { sourceFolder, publicFolder, workFolder, digest, probe, run } from './media-tools.mjs';
import { mediaStep, failureReport } from './media-diagnostics.mjs';
import {
  VARIANTS,
  FPS,
  SCENE_SECONDS,
  SCENE_FRAMES,
  sceneFilter,
  timingArgs,
  assertSceneTiming,
  finishFilm,
} from './hero-video-encoding.mjs';

async function screenshots() {
  const base = process.env.MEDIA_PREVIEW_URL ?? 'http://127.0.0.1:3000';
  const origin = new URL(base).origin;
  if (!['http:', 'https:'].includes(new URL(base).protocol))
    throw new Error('Invalid preview URL.');
  const browser = await mediaStep('Launching Chromium', () => chromium.launch());
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
    });
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith('/api/'))
        return route.fulfill({
          status: 401,
          json: { error: { code: 'AUTH_REQUIRED', message: 'Sign in.', requestId: 'media-demo' } },
        });
      return route.continue();
    });
    await mediaStep('Opening the landing page', () => page.goto(base));
    await mediaStep('Loading demo fonts and walkthrough', async () => {
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.walkthrough').scrollIntoViewIfNeeded();
    });
    for (const scene of [1, 2, 3]) {
      await mediaStep(`Selecting demo scene ${scene}`, async () => {
        await page.locator('.story-steps button').nth(scene).click();
        await page.locator(`.demo-phone.scene-${scene}`).waitFor({ state: 'visible' });
      });
      await mediaStep(`Capturing demo scene ${scene}`, () =>
        page
          .locator(scene === 1 ? '.demo-desktop' : '.demo-phone')
          .screenshot({ path: join(workFolder, `scene-${scene}.png`), animations: 'disabled' }),
      );
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(sourceFolder, { recursive: true });
  await mkdir(workFolder, { recursive: true });
  await rm(join(workFolder, 'render-failure.json'), { force: true });
  await mediaStep('Checking FFmpeg', () => run('ffmpeg', ['-version']));
  await mediaStep('Checking FFprobe', () => run('ffprobe', ['-version']));
  await mediaStep('Checking the caption font', () => readFile(join(sourceFolder, 'Antonio.ttf')));
  const folder = join(publicFolder, 'media');
  const register = await mediaStep('Reading the asset register', async () =>
    JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')),
  );
  const masters = [];
  for (const [index, asset] of register.videos.entries())
    masters.push(
      await mediaStep(`Preparing video master ${index + 1}`, () => loadVideoMaster(asset)),
    );
  await mediaStep('Capturing the product walkthrough', screenshots);
  const captions = [
    'MORE FOOTBALL.',
    'OPEN TRAINING ATTENDANCE.',
    'SCAN. ARRIVAL RECORDED.',
    'LESS ADMIN.',
  ];
  const outputs = [];
  for (const spec of VARIANTS) {
    const { name: variant, width, height } = spec;
    const clips = [];
    for (let scene = 0; scene < 4; scene++) {
      const input = scene === 1 ? 1 : 0;
      const asset = register.videos[input];
      const clip = join(workFolder, `${variant}-${scene}.mp4`);
      const args = ['-y', '-ss', String(asset.trimStart), '-i', masters[input]];
      if (scene) {
        const panel = join(workFolder, `${variant}-panel-${scene}.png`);
        await mediaStep(`Preparing ${variant} overlay ${scene}`, () =>
          sharp(join(workFolder, `scene-${scene}.png`))
            .resize({
              width: variant === 'mobile' ? 590 : scene === 1 ? 1150 : 470,
              height: variant === 'mobile' ? 610 : 740,
              fit: 'inside',
            })
            .png()
            .toFile(panel),
        );
        args.push('-loop', '1', '-framerate', String(FPS), '-i', panel);
      }
      const font = join(sourceFolder, 'Antonio.ttf');
      const base = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=24,drawbox=x=0:y=0:w=iw:h=${variant === 'mobile' ? 130 : 170}:color=0x103c29@0.95:t=fill,drawtext=fontfile=${font}:text='${captions[scene]}':fontcolor=white:fontsize=${variant === 'mobile' ? 34 : 64}:x=40:y=42`;
      const foot = `drawtext=fontfile=${font}:text='PitchPresence.  Product demo':fontcolor=white:fontsize=${variant === 'mobile' ? 24 : 36}:x=40:y=h-55:box=1:boxcolor=0x103c29@0.9:boxborderw=12`;
      const filter = sceneFilter(base, foot, Boolean(scene));
      args.push(
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
      );
      await mediaStep(`Encoding ${variant} scene ${scene + 1}`, () => run('ffmpeg', args));
      await mediaStep(`Validating ${variant} scene ${scene + 1} timing`, async () =>
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
    duration: 12,
    outputs,
    recipe: 'scripts/render-hero-video.mjs',
    scenes: captions,
  };
  await writeFile(join(folder, 'manifest.json'), JSON.stringify(register, null, 2) + '\n');
  const filmPath = join(folder, 'film.json');
  const film = JSON.parse(await readFile(filmPath, 'utf8'));
  await writeFile(filmPath, JSON.stringify({ ...film, ready: true }, null, 2) + '\n');
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
