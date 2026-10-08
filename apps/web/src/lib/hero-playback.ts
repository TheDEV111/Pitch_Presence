type FilmElement = Pick<
  HTMLVideoElement,
  'src' | 'poster' | 'muted' | 'paused' | 'ended' | 'currentTime' | 'play' | 'pause'
>;
type Options = {
  video: FilmElement;
  source: () => { video: string; poster: string };
  hidden: () => boolean;
  reducedMotion: () => boolean;
  onActivate: () => void;
  onFailure: () => void;
};

export function createHeroPlayback(options: Options) {
  const { video } = options;
  let visible = false;
  let userPaused = false;
  let activated = false;
  let failed = false;
  let disposed = false;
  let generation = 0;
  const allowed = () =>
    visible && !userPaused && !failed && !disposed && !options.hidden() && !options.reducedMotion();
  function pause() {
    generation++;
    video.pause();
  }
  function fail() {
    if (failed || disposed) return;
    failed = true;
    pause();
    options.onFailure();
  }
  async function start(restart: boolean, manual = false) {
    if (!allowed() || (!restart && !manual && video.ended)) return;
    const attempt = ++generation;
    try {
      if (!activated) {
        const source = options.source();
        video.muted = true;
        video.poster = source.poster;
        video.src = source.video;
        activated = true;
        options.onActivate();
      }
      if ((restart || video.ended) && video.currentTime > 0) video.currentTime = 0;
      await video.play();
      if (!allowed()) pause();
    } catch (error) {
      if (disposed || attempt !== generation) return;
      // A pause may abort play; browser autoplay policies may reject it.
      // Retain the poster and allow a later scroll entry or explicit resume.
      if (
        (error instanceof Error || error instanceof DOMException) &&
        ['AbortError', 'NotAllowedError'].includes(error.name)
      )
        return;
      fail();
    }
  }
  return {
    visibilityChanged(next: boolean) {
      if (next === visible) return;
      visible = next;
      if (visible) void start(true);
      else pause();
    },
    environmentChanged() {
      if (allowed()) void start(false);
      else pause();
    },
    toggle() {
      if (userPaused || video.paused) {
        userPaused = false;
        void start(false, true);
      } else {
        userPaused = true;
        pause();
      }
    },
    fail,
    dispose() {
      disposed = true;
      pause();
    },
  };
}
