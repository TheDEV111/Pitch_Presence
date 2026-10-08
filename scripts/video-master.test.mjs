import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVideoMaster } from './video-master.mjs';
import { digest } from './media-tools.mjs';

const folders = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'pitch-video-'));
  folders.push(folder);
  const asset = {
    name: 'warmup',
    master: 'warmup.mp4',
    source: 'https://www.pexels.com/video/man-warming-up-on-a-soccer-field-7187051/',
    download: 'https://videos.pexels.com/video-files/7187051/7187051-hd_1920_1080_24fps.mp4',
    trimStart: 0,
    trimDuration: 3,
  };
  const inspect = vi.fn().mockResolvedValue({
    streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
    format: { duration: '12.0' },
  });
  const downloadMaster = vi.fn(async (_url, path) => writeFile(path, 'synthetic master bytes'));
  return { folder, asset, inspect, downloadMaster };
}

it('downloads the registered CDN MP4 rather than fetching the source HTML page', async () => {
  const f = await fixture();
  const path = await loadVideoMaster(f.asset, f);
  expect(f.downloadMaster).toHaveBeenCalledExactlyOnceWith(f.asset.download, path);
  expect(f.inspect).toHaveBeenCalledExactlyOnceWith(path);
  expect(f.asset.masterSha256).toBe(digest('synthetic master bytes'));
  expect(f.asset.width).toBe(1920);
});

it('reuses a matching local master without another download and rejects checksum drift', async () => {
  const f = await fixture();
  const path = join(f.folder, f.asset.master);
  await writeFile(path, 'local bytes');
  f.asset.masterSha256 = digest('local bytes');
  await loadVideoMaster(f.asset, f);
  expect(f.downloadMaster).not.toHaveBeenCalled();
  await writeFile(path, 'changed bytes');
  await expect(loadVideoMaster(f.asset, f)).rejects.toThrow('Video master changed');
});

it('rejects download URLs belonging to a different source before any network call', async () => {
  const f = await fixture();
  f.asset.download = 'https://videos.pexels.com/video-files/123/other.mp4';
  await expect(loadVideoMaster(f.asset, f)).rejects.toThrow('Invalid direct video download');
  expect(f.downloadMaster).not.toHaveBeenCalled();
});

it('reports unavailable CDN downloads without pretending the master exists', async () => {
  const f = await fixture();
  f.downloadMaster.mockRejectedValue(new Error('unavailable'));
  await expect(loadVideoMaster(f.asset, f)).rejects.toThrow('direct MP4 download is unavailable');
  expect(f.inspect).not.toHaveBeenCalled();
});

it('rejects invalid duration or undersized footage before recording its checksum', async () => {
  for (const metadata of [
    { streams: [{ codec_type: 'video', width: 1920, height: 1080 }], format: {} },
    { streams: [{ codec_type: 'video', width: 640, height: 360 }], format: { duration: '12' } },
    { streams: [{ codec_type: 'video', width: 1920, height: 1080 }], format: { duration: '2' } },
  ]) {
    const f = await fixture();
    f.inspect.mockResolvedValue(metadata);
    await expect(loadVideoMaster(f.asset, f)).rejects.toThrow('Invalid or undersized video master');
    expect(f.asset.masterSha256).toBeUndefined();
  }
});

it('uses a supplied master with recorded rights and checksum without downloading it', async () => {
  const f = await fixture();
  Object.assign(f.asset, {
    delivery: 'local',
    source: 'Original team training footage',
    creator: 'Team videographer',
    license: 'Owned footage cleared for the product website',
    masterSha256: digest('local bytes'),
  });
  delete f.asset.download;
  const path = join(f.folder, f.asset.master);
  await writeFile(path, 'local bytes');
  await expect(loadVideoMaster(f.asset, f)).resolves.toBe(path);
  expect(f.downloadMaster).not.toHaveBeenCalled();
  await writeFile(path, 'different footage');
  await expect(loadVideoMaster(f.asset, f)).rejects.toThrow('Video master changed');
});

it('rejects missing supplied footage or unrecorded usage rights without network fallback', async () => {
  const f = await fixture();
  f.asset.delivery = 'local';
  await expect(loadVideoMaster(f.asset, f)).rejects.toThrow(
    'checksum, creator, source and usage rights',
  );
  Object.assign(f.asset, {
    source: 'Original footage',
    creator: 'Team videographer',
    license: 'Owned footage',
    masterSha256: digest('local bytes'),
  });
  await expect(loadVideoMaster(f.asset, f)).rejects.toThrow('arrival master is missing');
  expect(f.downloadMaster).not.toHaveBeenCalled();
  expect(f.inspect).not.toHaveBeenCalled();
});
