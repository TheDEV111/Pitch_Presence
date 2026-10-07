import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sourceFolder, download, probe, digest } from './media-tools.mjs';

export async function loadVideoMaster(
  asset,
  { folder = sourceFolder, downloadMaster = download, inspect = probe } = {},
) {
  if (!/^[a-z-]+$/.test(asset.name) || asset.master !== `${asset.name}.mp4`)
    throw new Error('Invalid video master name.');
  const source = new URL(asset.source);
  const url = new URL(asset.download);
  const id = source.pathname.match(/-(\d+)\/?$/)?.[1];
  if (
    source.protocol !== 'https:' ||
    source.hostname !== 'www.pexels.com' ||
    !id ||
    url.protocol !== 'https:' ||
    url.hostname !== 'videos.pexels.com' ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(`/video-files/${id}/`) ||
    !url.pathname.endsWith('.mp4')
  )
    throw new Error(
      'Invalid direct video download. Register the official MP4 URL for this licensed source.',
    );
  await mkdir(folder, { recursive: true });
  const path = join(folder, asset.master);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      // Download the recorded CDN file, never the HTML page protected by bot checks.
      await downloadMaster(url.href, path);
      bytes = await readFile(path);
    } catch {
      throw new Error(
        `Download the licensed ${asset.name} master to .media-source/${asset.master}; its direct MP4 download is unavailable. See the registered source page.`,
      );
    }
  }
  if (asset.masterSha256 && digest(bytes) !== asset.masterSha256)
    throw new Error(`Video master changed: ${asset.name}. Review the asset register.`);
  const metadata = await inspect(path);
  const stream = metadata.streams?.find((stream) => stream.codec_type === 'video');
  const duration = Number(metadata.format?.duration);
  if (
    !stream ||
    !Number.isFinite(stream.width) ||
    !Number.isFinite(stream.height) ||
    stream.width < 1280 ||
    stream.height < 720 ||
    !Number.isFinite(duration) ||
    !Number.isFinite(asset.trimStart) ||
    !Number.isFinite(asset.trimDuration) ||
    asset.trimStart < 0 ||
    asset.trimDuration <= 0 ||
    duration < asset.trimStart + asset.trimDuration
  )
    throw new Error(`Invalid or undersized video master: ${asset.name}.`);
  asset.masterSha256 = digest(bytes);
  asset.width = stream.width;
  asset.height = stream.height;
  asset.duration = duration;
  return path;
}
