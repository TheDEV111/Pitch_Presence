'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import film from '../../public/media/film.json';
import { Photo } from './photo';
import { createHeroPlayback } from '@/lib/hero-playback';

export function HeroFilm({
  presentation = 'hero',
  fallbackKind = 'training',
}: {
  presentation?: 'hero' | 'split';
  fallbackKind?: 'training' | 'coach';
}) {
  const split = presentation === 'split';
  const descriptionId = useId();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const playback = useRef<ReturnType<typeof createHeroPlayback> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const element = video.current;
    const visual = frame.current;
    if (!film.ready || !element || !visual) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const wide = matchMedia('(min-width: 768px)');
    const controller = createHeroPlayback({
      video: element,
      source: () =>
        split || matchMedia('(max-width: 767px)').matches
          ? { video: film.mobile, poster: film.mobilePoster }
          : { video: film.desktop, poster: film.desktopPoster },
      hidden: () => document.hidden || (split && !wide.matches),
      reducedMotion: () => motion.matches,
      onActivate: () => setLoaded(true),
      onFailure: () => {
        setFailed(true);
        setPlaying(false);
      },
    });
    playback.current = controller;
    const hide = () => controller.environmentChanged();
    const reduce = () => {
      setReduced(motion.matches);
      controller.environmentChanged();
    };
    setReduced(motion.matches);
    const observer = new IntersectionObserver(
      ([entry]) =>
        controller.visibilityChanged(entry.isIntersecting && entry.intersectionRatio >= 0.25),
      { threshold: [0, 0.25] },
    );
    observer.observe(visual);
    document.addEventListener('visibilitychange', hide);
    motion.addEventListener('change', reduce);
    wide.addEventListener('change', hide);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', hide);
      motion.removeEventListener('change', reduce);
      wide.removeEventListener('change', hide);
      controller.dispose();
      playback.current = null;
    };
  }, [split]);
  if (!film.ready) return <Photo eager kind={fallbackKind} />;
  return (
    <div className={`hero-film${split ? ' split-film' : ''}`}>
      {split && (
        <div className="split-film-mobile">
          <Photo kind={fallbackKind} />
        </div>
      )}
      <div className="film-visual" ref={frame}>
        {(!loaded || failed) &&
          (failed || posterFailed ? (
            <Photo eager kind={fallbackKind} />
          ) : (
            <picture>
              <source media={split ? 'all' : '(max-width: 767px)'} srcSet={film.mobilePoster} />
              <img
                className="photo"
                src={film.desktopPoster}
                width={1920}
                height={1080}
                alt="Football players warming up on a pitch."
                loading={split ? 'lazy' : 'eager'}
                fetchPriority={split ? 'auto' : 'high'}
                onError={() => setPosterFailed(true)}
              />
            </picture>
          ))}
        <video
          ref={video}
          preload="none"
          muted
          playsInline
          hidden={!loaded || failed}
          aria-label={split ? 'Football training film' : 'PitchPresence training-day film'}
          aria-describedby={descriptionId}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => playback.current?.fail()}
        />
        {loaded && !failed && !reduced && (
          <div className="film-controls">
            <button
              className="icon-button film-toggle"
              aria-label={playing ? 'Pause film' : 'Resume film'}
              title={playing ? 'Pause film' : 'Resume film'}
              onClick={() => playback.current?.toggle()}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
          </div>
        )}
        {failed && (
          <p className="film-error" role="status">
            {split
              ? 'The film could not play.'
              : 'The film could not play. Explore the walkthrough below.'}
          </p>
        )}
      </div>
      <p id={descriptionId} className={split ? 'sr-only' : 'film-description'}>
        {film.description}
      </p>
    </div>
  );
}
