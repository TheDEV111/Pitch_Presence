import { expect, it, vi } from 'vitest';
import { createHeroPlayback } from '../src/lib/hero-playback';

function fixture() {
  const environment = { hidden: false, reduced: false };
  const video = {
    src: '',
    poster: '',
    muted: false,
    paused: true,
    ended: false,
    currentTime: 0,
    play: vi.fn(async () => {
      video.paused = false;
    }),
    pause: vi.fn(() => {
      video.paused = true;
    }),
  };
  const options = {
    video,
    source: vi.fn(() => ({
      video: '/media/hero-mobile.mp4',
      poster: '/media/hero-mobile-poster.webp',
    })),
    hidden: () => environment.hidden,
    reducedMotion: () => environment.reduced,
    onActivate: vi.fn(),
    onFailure: vi.fn(),
  };
  return { video, environment, options, controller: createHeroPlayback(options) };
}

it('defers the source until visible, autoplays muted and restarts once per scroll entry', async () => {
  const f = fixture();
  expect(f.video.src).toBe('');
  f.controller.visibilityChanged(true);
  await Promise.resolve();
  expect(f.video.muted).toBe(true);
  expect(f.video.src).toBe('/media/hero-mobile.mp4');
  expect(f.video.play).toHaveBeenCalledTimes(1);
  f.video.currentTime = 5;
  f.controller.visibilityChanged(true);
  expect(f.video.currentTime).toBe(5);
  f.controller.visibilityChanged(false);
  expect(f.video.paused).toBe(true);
  f.controller.visibilityChanged(true);
  await Promise.resolve();
  expect(f.video.currentTime).toBe(0);
  expect(f.video.play).toHaveBeenCalledTimes(2);
  expect(f.options.source).toHaveBeenCalledTimes(1);
});

it('preserves an explicit pause across scroll and tab changes until the user resumes', async () => {
  const f = fixture();
  f.controller.visibilityChanged(true);
  await Promise.resolve();
  f.video.currentTime = 4;
  f.controller.toggle();
  f.controller.visibilityChanged(false);
  f.controller.visibilityChanged(true);
  f.controller.environmentChanged();
  expect(f.video.paused).toBe(true);
  expect(f.video.play).toHaveBeenCalledTimes(1);
  f.controller.toggle();
  await Promise.resolve();
  expect(f.video.play).toHaveBeenCalledTimes(2);
  expect(f.video.currentTime).toBe(4);
});

it('makes no video request with reduced motion and responds to preference changes', async () => {
  const f = fixture();
  f.environment.reduced = true;
  f.controller.visibilityChanged(true);
  expect(f.video.src).toBe('');
  expect(f.video.play).not.toHaveBeenCalled();
  f.environment.reduced = false;
  f.controller.environmentChanged();
  await Promise.resolve();
  expect(f.video.paused).toBe(false);
  f.environment.reduced = true;
  f.controller.environmentChanged();
  expect(f.video.paused).toBe(true);
});

it('pauses hidden tabs and leaves a completed film stopped until another scroll entry', async () => {
  const f = fixture();
  f.controller.visibilityChanged(true);
  await Promise.resolve();
  f.environment.hidden = true;
  f.controller.environmentChanged();
  expect(f.video.paused).toBe(true);
  f.video.ended = true;
  f.video.currentTime = 12;
  f.environment.hidden = false;
  f.controller.environmentChanged();
  expect(f.video.play).toHaveBeenCalledTimes(1);
  f.controller.visibilityChanged(false);
  f.controller.visibilityChanged(true);
  await Promise.resolve();
  expect(f.video.play).toHaveBeenCalledTimes(2);
  expect(f.video.currentTime).toBe(0);
});

it('retains the poster after autoplay denial or interruption and permits another attempt', async () => {
  for (const name of ['NotAllowedError', 'AbortError']) {
    const f = fixture();
    f.video.play.mockRejectedValueOnce(new DOMException('Browser interrupted playback.', name));
    f.controller.visibilityChanged(true);
    await Promise.resolve();
    expect(f.options.onFailure).not.toHaveBeenCalled();
    expect(f.video.poster).toBe('/media/hero-mobile-poster.webp');
    f.controller.toggle();
    await Promise.resolve();
    expect(f.video.play).toHaveBeenCalledTimes(2);
  }
});

it('ignores rejected promises after disposal and falls back on genuine playback errors', async () => {
  const f = fixture();
  let reject!: (error: Error) => void;
  f.video.play.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, failure) => {
        reject = failure;
      }),
  );
  f.controller.visibilityChanged(true);
  f.controller.dispose();
  reject(new Error('Cancelled after unmount.'));
  await Promise.resolve();
  expect(f.options.onFailure).not.toHaveBeenCalled();
  const broken = fixture();
  broken.video.play.mockRejectedValueOnce(new Error('Unsupported media.'));
  broken.controller.visibilityChanged(true);
  await Promise.resolve();
  expect(broken.options.onFailure).toHaveBeenCalledTimes(1);
  broken.controller.visibilityChanged(false);
  broken.controller.visibilityChanged(true);
  expect(broken.video.play).toHaveBeenCalledTimes(1);
});
