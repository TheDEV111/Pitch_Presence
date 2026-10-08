'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import film from '../../public/media/film.json';
import { Photo } from './photo';
import { createHeroPlayback } from '@/lib/hero-playback';

export function HeroFilm() {
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
    const controller = createHeroPlayback({
      video: element,
      source: () =>
        matchMedia('(max-width: 767px)').matches
          ? { video: film.mobile, poster: film.mobilePoster }
          : { video: film.desktop, poster: film.desktopPoster },
      hidden: () => document.hidden,
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
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', hide);
      motion.removeEventListener('change', reduce);
      controller.dispose();
      playback.current = null;
    };
  }, []);
  if (!film.ready) return <Photo eager />;
  return (
    <div className="hero-film">
      <div className="film-visual" ref={frame}>
        {(!loaded || failed) &&
          (failed || posterFailed ? (
            <Photo eager />
          ) : (
            <picture>
              <source media="(max-width: 767px)" srcSet={film.mobilePoster} />
              <img
                className="photo"
                src={film.desktopPoster}
                width={1920}
                height={1080}
                alt="Football players warming up on a pitch."
                loading="eager"
                fetchPriority="high"
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
          aria-label="PitchPresence training-day film"
          aria-describedby="film-description"
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
            The film could not play. Explore the walkthrough below.
          </p>
        )}
      </div>
      <p id="film-description" className="film-description">
        {film.description}
      </p>
    </div>
  );
}
