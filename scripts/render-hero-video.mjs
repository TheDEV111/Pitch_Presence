import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { chromium } from '@playwright/test';
import { loadVideoMaster } from './video-master.mjs';
import { sourceFolder, publicFolder, workFolder, digest, probe, run } from './media-tools.mjs';

async function screenshots() {
  const base = process.env.MEDIA_PREVIEW_URL ?? 'http://127.0.0.1:3000';
  const origin = new URL(base).origin;
  if (!['http:', 'https:'].includes(new URL(base).protocol))
    throw new Error('Invalid preview URL.');
  const browser = await chromium.launch();
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
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.walkthrough').scrollIntoViewIfNeeded();
    for (const scene of [1, 2, 3]) {
      await page.locator('.story-steps button').nth(scene).click();
      await page.locator(`.demo-phone.scene-${scene}`).waitFor({ state: 'visible' });
      await page
        .locator(scene === 1 ? '.demo-desktop' : '.demo-phone')
        .screenshot({ path: join(workFolder, `scene-${scene}.png`), animations: 'disabled' });
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  await run('ffmpeg', ['-version']);
  await run('ffprobe', ['-version']);
  await mkdir(sourceFolder, { recursive: true });
  await mkdir(workFolder, { recursive: true });
  const folder = join(publicFolder, 'media');
  const register = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  const masters = [];
  for (const asset of register.videos) masters.push(await loadVideoMaster(asset));
  await screenshots();
  const captions = [
    'MORE FOOTBALL.',
    'OPEN TRAINING ATTENDANCE.',
    'SCAN. ARRIVAL RECORDED.',
    'LESS ADMIN.',
  ];
  const outputs = [];
  for (const [variant, width, height, rate] of [
    ['desktop', 1920, 1080, '1900k'],
    ['mobile', 720, 900, '900k'],
  ]) {
    const clips = [];
    for (let scene = 0; scene < 4; scene++) {
      const input = scene === 1 ? 1 : 0;
      const asset = register.videos[input];
      const clip = join(workFolder, `${variant}-${scene}.mp4`);
      const args = ['-y', '-ss', String(asset.trimStart), '-i', masters[input]];
      if (scene) {
        const panel = join(workFolder, `${variant}-panel-${scene}.png`);
        await sharp(join(workFolder, `scene-${scene}.png`))
          .resize({
            width: variant === 'mobile' ? 590 : scene === 1 ? 1150 : 470,
            height: variant === 'mobile' ? 610 : 740,
            fit: 'inside',
          })
          .png()
          .toFile(panel);
        args.push('-loop', '1', '-i', panel);
      }
      const font = join(sourceFolder, 'Antonio.ttf');
      const base = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=24,drawbox=x=0:y=0:w=iw:h=${variant === 'mobile' ? 130 : 170}:color=0x103c29@0.95:t=fill,drawtext=fontfile=${font}:text='${captions[scene]}':fontcolor=white:fontsize=${variant === 'mobile' ? 34 : 64}:x=40:y=42`;
      const foot = `drawtext=fontfile=${font}:text='PitchPresence.  Product demo':fontcolor=white:fontsize=${variant === 'mobile' ? 24 : 36}:x=40:y=h-55:box=1:boxcolor=0x103c29@0.9:boxborderw=12`;
      const filter = scene
        ? `[0:v]${base}[base];[base][1:v]overlay=x=(W-w)/2:y=(H-h)/2+35,${foot}[out]`
        : `[0:v]${base},${foot}[out]`;
      args.push(
        '-filter_complex',
        filter,
        '-map',
        '[out]',
        '-t',
        '3',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '26',
        '-maxrate',
        rate,
        '-bufsize',
        variant === 'mobile' ? '1800k' : '3800k',
        '-pix_fmt',
        'yuv420p',
        clip,
      );
      await run('ffmpeg', args);
      clips.push(clip);
    }
    const list = join(workFolder, `${variant}-concat.txt`);
    await writeFile(
      list,
      clips.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join('\n') + '\n',
    );
    const file = `hero-${variant}.mp4`;
    const output = join(folder, file);
    await run('ffmpeg', [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      output,
    ]);
    const metadata = await probe(output);
    const bytes = await readFile(output);
    const budget = variant === 'mobile' ? 1500000 : 3000000;
    if (bytes.length > budget || Math.abs(Number(metadata.format.duration) - 12) > 0.15)
      throw new Error(`Film ${variant} failed size/duration acceptance.`);
    const poster = join(workFolder, `${variant}-poster.png`);
    await run('ffmpeg', ['-y', '-i', output, '-frames:v', '1', poster]);
    await sharp(poster)
      .webp({ quality: 76 })
      .toFile(join(folder, `hero-${variant}-poster.webp`));
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
main().catch((error) => {
  if (
    error instanceof Error &&
    /^(Download the licensed|Invalid or undersized|Video master changed|ffmpeg is unavailable|ffprobe is unavailable)/.test(
      error.message,
    )
  )
    console.error(error.message);
  console.error(
    'Film could not complete. Requires FFmpeg/FFprobe, licensed masters, local fonts, Chromium and a running preview. Existing poster/photography remains available. See docs/frontend/pwa-media.md.',
  );
  process.exitCode = 1;
});
