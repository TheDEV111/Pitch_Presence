'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, CreditCard, Pause, Play, RotateCcw, ScanLine } from 'lucide-react';
import { Button, Status } from './ui';
const descriptions = [
  'Open attendance for training.',
  'Players scan when they arrive.',
  'Each check-in has a recorded time.',
  'Keep in-app and external payments in one monthly history.',
];
export function Walkthrough() {
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const scene = seconds < 5 ? 0 : seconds < 10 ? 1 : seconds < 14 ? 2 : 3;
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setReduced(media.matches);
      if (media.matches) setPlaying(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) setPlaying(false);
      },
      { threshold: 0.25 },
    );
    if (stage.current) observer.observe(stage.current);
    const hide = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setSeconds((old) => {
          if (old >= 19) {
            setPlaying(false);
            return 20;
          }
          return old + 1;
        }),
      1000,
    );
    return () => clearInterval(timer);
  }, [playing]);
  return (
    <div className="walkthrough" ref={stage}>
      <div className="demo-top">
        <span className="eyebrow">
          <span className="live-dot" /> Product demo · fictional team
        </span>
        <span className="muted">A training day, simplified</span>
      </div>
      <div className="demo-stage">
        <div className="demo-desktop">
          <div className="demo-toolbar">
            <span className="mini-mark">P.</span>
            <strong>Saturday training</strong>
            <Status value="OPEN" />
          </div>
          <div className="demo-columns">
            <div className="demo-qr">
              <div className="sample-code" aria-hidden="true">
                <ScanLine size={96} strokeWidth={1} />
                <span>DEMO</span>
              </div>
              <span className="eyebrow">Attendance is open</span>
              <p>
                Scan when you arrive.
                <br />
                Get back to the pitch.
              </p>
              <small>Illustration only — not a scannable code</small>
            </div>
            <div className="demo-roster">
              <div className="between">
                <strong>Team arrivals</strong>
                <span className="muted">{scene ? '2' : '0'} / 3</span>
              </div>
              {['Tobi Adeyemi', 'Daniel Okafor', 'Samuel Bello'].map((name, index) => (
                <div className="person-row" key={name}>
                  <span className="avatar">
                    {name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')}
                  </span>
                  <div>
                    <strong>{name}</strong>
                    <small>
                      {scene && index < 2
                        ? `Recorded at 08:${index ? '42' : '38'}`
                        : 'Waiting for arrival'}
                    </small>
                  </div>
                  {scene && index < 2 ? (
                    <span className="check-circle">
                      <Check size={16} />
                    </span>
                  ) : (
                    <span className="waiting-dot" />
                  )}
                </div>
              ))}
              <p className="demo-note">Every arrival. One shared view.</p>
            </div>
          </div>
        </div>
        <div className={`demo-phone scene-${scene}`}>
          <div className="phone-speaker" />
          <span className="eyebrow">Player view · demo</span>
          {scene < 2 ? (
            <>
              <ScanLine size={48} />
              <h3>{scene === 0 ? 'Ready for training?' : 'You’re up, Tobi.'}</h3>
              <p>Use your phone’s camera to scan the code at the pitch.</p>
              <span className="phone-label">Saturday training</span>
            </>
          ) : scene === 2 ? (
            <>
              <span className="big-check">
                <CheckCheck size={38} />
              </span>
              <h3>You’re checked in.</h3>
              <p>
                Saturday training
                <br />
                Arrival recorded at 08:38.
              </p>
              <span className="phone-label">See you on the pitch.</span>
            </>
          ) : (
            <>
              <CreditCard size={38} />
              <h3>A month sorted.</h3>
              <div className="phone-payment">
                <span>October dues</span>
                <strong>₦5,000</strong>
                <Status value="PAID" />
              </div>
              <p>Verified in-app payments and manager-confirmed external payments, together.</p>
            </>
          )}
        </div>
      </div>
      <div className="demo-controls">
        <div className="actions">
          <Button
            variant="secondary"
            onClick={() => {
              if (reduced) {
                setSeconds(scene === 3 ? 0 : [5, 10, 14][scene]);
                return;
              }
              if (seconds >= 20) setSeconds(0);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}{' '}
            {reduced ? 'Next scene' : playing ? 'Pause' : 'Play walkthrough'}
          </Button>
          <button
            className="icon-button"
            onClick={() => {
              setSeconds(0);
              setPlaying(false);
            }}
            aria-label="Replay walkthrough"
          >
            <RotateCcw size={18} />
          </button>
        </div>
        <div className="chapter-tabs">
          <button
            aria-pressed={scene < 3}
            onClick={() => {
              setSeconds(0);
              setPlaying(false);
            }}
          >
            Attendance
          </button>
          <button
            aria-pressed={scene === 3}
            onClick={() => {
              setSeconds(14);
              setPlaying(false);
            }}
          >
            Dues
          </button>
        </div>
      </div>
      <div className="demo-progress">
        <span style={{ width: `${(seconds / 20) * 100}%` }} />
      </div>
      <p className="demo-caption" aria-live="polite">
        {descriptions[scene]}
      </p>
      <div className="story-steps">
        {['Open a session', 'Players check in', 'Arrivals recorded', 'Dues confirmed'].map(
          (label, index) => (
            <button
              key={label}
              aria-pressed={scene === index}
              onClick={() => {
                setSeconds([0, 5, 10, 14][index]);
                setPlaying(false);
              }}
            >
              <span>0{index + 1}</span>
              {label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
