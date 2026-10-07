'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import film from '../../public/media/film.json';
import { Photo } from './photo';
import { Button } from './ui';

export function HeroFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const activated = useRef(false);
  const playPending = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = frame.current;
    const pause = () => {
      video.current?.pause();
      setPlaying(false);
    };
    const hide = () => {
      if (document.hidden) pause();
    };
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const reduce = () => {
      if (motion.matches) pause();
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) pause();
      },
      { threshold: 0.25 },
    );
    if (element) observer.observe(element);
    document.addEventListener('visibilitychange', hide);
    motion.addEventListener('change', reduce);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', hide);
      motion.removeEventListener('change', reduce);
    };
  }, []);
  async function play(replay = false) {
    const element = video.current;
    if (!element || playPending.current) return;
    playPending.current = true;
    setBusy(true);
    try {
      const mobile = matchMedia('(max-width: 767px)').matches;
      if (!activated.current) {
        // Keep src outside React props: writing it again during rendering would
        // restart resource selection and interrupt the pending play promise.
        element.poster = mobile ? film.mobilePoster : film.desktopPoster;
        element.src = mobile ? film.mobile : film.desktop;
        activated.current = true;
        setLoaded(true);
      }
      if (replay) element.currentTime = 0;
      await element.play();
    } catch (error) {
      // A visibility pause can legitimately interrupt a pending play request.
      // Keep the controls available for the user's next attempt.
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
      setPlaying(false);
    } finally {
      playPending.current = false;
      setBusy(false);
    }
  }
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
                alt="Football training, with a PitchPresence product demonstration."
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
          onError={() => {
            setFailed(true);
            setPlaying(false);
          }}
        />
        {!failed && (
          <div className="film-controls">
            <Button busy={busy} onClick={() => (playing ? video.current?.pause() : void play())}>
              {playing ? <Pause size={17} /> : <Play size={17} />}
              {playing ? 'Pause film' : 'Play film'}
            </Button>
            {loaded && (
              <Button disabled={busy} onClick={() => void play(true)}>
                <RotateCcw size={17} /> Replay film
              </Button>
            )}
          </div>
        )}
        {failed && (
          <p className="film-error" role="status">
            The film could not play. Explore the walkthrough below.
          </p>
        )}
      </div>
      <p id="film-description" className="film-description">
        {film.description} Product screens use demo data.
      </p>
    </div>
  );
}
