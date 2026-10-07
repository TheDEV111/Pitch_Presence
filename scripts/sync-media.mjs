import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { sourceFolder, publicFolder, localMaster, digest, run } from './media-tools.mjs';

async function main() {
  const folder = join(publicFolder, 'media');
  const register = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  await mkdir(folder, { recursive: true });
  for (const asset of register.assets) {
    if (!/^[a-z-]+$/.test(asset.name)) throw new Error('Invalid asset name.');
    const master = await localMaster(`${asset.name}.jpg`, asset.download);
    if (asset.masterSha256 && asset.masterSha256 !== digest(master))
      throw new Error(
        `Master changed: ${asset.name}. Review the source before updating the asset register.`,
      );
    const metadata = await sharp(master).metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      !['jpeg', 'png', 'webp', 'avif'].includes(metadata.format)
    )
      throw new Error(`Invalid image master: ${asset.name}.`);
    if (
      (asset.name === 'training' && metadata.width < 2400) ||
      (asset.name === 'coach' && metadata.width < 1200)
    )
      throw new Error(`Image master too small: ${asset.name}.`);
    asset.width = metadata.width;
    asset.height = metadata.height;
    asset.masterSha256 = digest(master);
    asset.outputs = [];
    for (const width of [320, 640, 960, 1440, 1920]) {
      const limit = width <= 640 ? 250000 : 500000;
      let bytes;
      for (const quality of [80, 72, 64, 56]) {
        bytes = await sharp(master)
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality, effort: 6 })
          .toBuffer();
        if (bytes.length <= limit) break;
      }
      if (bytes.length > limit) throw new Error(`Image exceeds budget: ${asset.name} ${width}px.`);
      const file = `${asset.name}-${width}.webp`;
      await writeFile(join(folder, file), bytes);
      asset.outputs.push({ file, bytes: bytes.length, sha256: digest(bytes) });
      console.log(`${file}: ${Math.ceil(bytes.length / 1000)}KB`);
    }
  }
  const fonts = join(publicFolder, 'fonts');
  await mkdir(fonts, { recursive: true });
  for (const [name, location] of [
    ['Antonio', 'antonio/Antonio%5Bwght%5D.ttf'],
    ['Inter', 'inter/Inter%5Bopsz,wght%5D.ttf'],
  ]) {
    const bytes = await localMaster(
      `${name}.ttf`,
      `https://raw.githubusercontent.com/google/fonts/main/ofl/${location}`,
    );
    const license = await localMaster(
      `${name}-OFL.txt`,
      `https://raw.githubusercontent.com/google/fonts/main/ofl/${name.toLowerCase()}/OFL.txt`,
    );
    const previous = register.fonts?.find((font) => font.name === name);
    if (previous?.masterSha256 && previous.masterSha256 !== digest(bytes))
      throw new Error(`Font master changed: ${name}. Review before updating.`);
    await writeFile(join(fonts, `${name}-OFL.txt`), license);
    await run('pyftsubset', [
      join(sourceFolder, `${name}.ttf`),
      `--output-file=${join(fonts, `${name}.woff2`)}`,
      '--flavor=woff2',
      '--unicodes=U+0000-024F,U+2000-206F,U+20A0-20CF',
      '--layout-features=*',
    ]);
    const output = await readFile(join(fonts, `${name}.woff2`));
    if (output.length > 180000) throw new Error(`Font exceeds 180KB budget: ${name}.`);
    register.fonts ??= [];
    register.fonts = register.fonts.filter((font) => font.name !== name);
    register.fonts.push({
      name,
      license: `${name}-OFL.txt`,
      file: `${name}.woff2`,
      masterSha256: digest(bytes),
      sha256: digest(output),
      bytes: output.length,
    });
  }
  await writeFile(join(folder, 'manifest.json'), JSON.stringify(register, null, 2) + '\n');
  console.log(
    'Local images and WOFF2 fonts prepared. Run media:video, then media:verify before release.',
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
