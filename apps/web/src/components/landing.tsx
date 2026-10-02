'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ClipboardList,
  Menu,
  ScanLine,
  Wallet,
  X,
} from 'lucide-react';
import { Logo, ActionLink, Status } from './ui';
import { Photo } from './photo';
import { Walkthrough } from './walkthrough';
import { api } from '@/lib/api';
import { sessionHome, type AuthSession } from './auth';
export function Landing() {
  const [menu, setMenu] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<AuthSession>('/auth/me', { signal: controller.signal })
      .then((result) => setSession(result))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const destination = session ? sessionHome(session) : '/signup';
  const action = session
    ? session.nextStep === 'READY'
      ? 'Open dashboard'
      : 'Finish team setup'
    : 'Create your team';
  return (
    <>
      <header className="site-header container">
        <Logo />
        <nav aria-label="Main navigation" className={menu ? 'site-nav open' : 'site-nav'}>
          <a href="#how-it-works" onClick={() => setMenu(false)}>
            How it works
          </a>
          <a href="#attendance" onClick={() => setMenu(false)}>
            Attendance
          </a>
          <a href="#dues" onClick={() => setMenu(false)}>
            Dues
          </a>
          <Link className="nav-auth" href={destination} onClick={() => setMenu(false)}>
            {action}
          </Link>
          {!session && (
            <Link className="nav-auth" href="/sign-in" onClick={() => setMenu(false)}>
              Sign in
            </Link>
          )}
        </nav>
        <div className="header-actions">
          {!session && (
            <Link href="/sign-in" className="text-action">
              Sign in
            </Link>
          )}
          <Link href={destination} className="button primary">
            {action}
            <ArrowUpRight size={17} />
          </Link>
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenu(!menu)}
            aria-expanded={menu}
            aria-label={menu ? 'Close menu' : 'Open menu'}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main id="main">
        <section className="hero container">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="live-dot" /> FOR THE PEOPLE BEHIND THE TEAM
            </p>
            <h1>
              MORE
              <br />
              FOOTBALL.
              <br />
              <span>LESS ADMIN.</span>
            </h1>
            <p className="hero-body">
              Keep training attendance and monthly dues in one place, so you can focus on the team.
            </p>
            <div className="actions">
              <ActionLink href={destination}>{action}</ActionLink>
              <a className="button secondary" href="#how-it-works">
                See how it works
                <ArrowDown size={17} />
              </a>
            </div>
            <p className="hero-footnote">Built around your team. Ready for training day.</p>
          </div>
          <div className="hero-media">
            <Photo eager />
            <div className="media-tag">
              <span className="live-dot" /> A LITTLE STRUCTURE. A LOT MORE GAME.
            </div>
            <div className="floating-arrival">
              <span className="check-circle">
                <Check size={19} />
              </span>
              <div>
                <strong>One less thing to keep track of.</strong>
                <small>Attendance. Dues. All together.</small>
              </div>
            </div>
            <span className="photo-caption">THE GAME STARTS BEFORE KICK-OFF.</span>
          </div>
        </section>
        <div className="value-strip container">
          <span>
            <ScanLine size={20} /> Training attendance
          </span>
          <span>
            <Wallet size={20} /> Monthly dues
          </span>
          <span>
            <ClipboardList size={20} /> A clearer team view
          </span>
          <a href="#how-it-works">
            Less chasing. More coaching.
            <ArrowUpRight size={16} />
          </a>
        </div>
        <section id="how-it-works" className="section container">
          <div className="section-heading">
            <div>
              <p className="eyebrow">01 / A TRAINING DAY, SIMPLIFIED</p>
              <h2>
                OPEN. SCAN.
                <br />
                CONFIRMED.
              </h2>
            </div>
            <p>
              From the first arrival to the final whistle, give your team a simple routine that
              keeps the records straight.
            </p>
          </div>
          <Walkthrough />
        </section>
        <section id="attendance" className="dark-band">
          <div className="container feature-split">
            <div>
              <p className="eyebrow">02 / EVERY ARRIVAL MATTERS</p>
              <h2>
                ONE TRAINING SESSION.
                <br />
                <span>EVERY ARRIVAL RECORDED.</span>
              </h2>
              <p>
                Open attendance at the pitch. Players scan a rotating QR code when they arrive. Your
                roster updates with the time each check-in was recorded.
              </p>
              <a href="#how-it-works" className="text-action">
                See the attendance story
                <ArrowUpRight size={20} />
              </a>
              <div className="feature-detail">
                <ScanLine size={23} />
                <span>
                  A fresh QR code, a shared roster,
                  <br />
                  and a record you can come back to.
                </span>
              </div>
            </div>
            <div className="attendance-art">
              <Photo kind="coach" />
              <div className="preview-card">
                <div className="between">
                  <span className="eyebrow">Saturday training · demo</span>
                  <Status value="OPEN" />
                </div>
                <h3>Good to see you, team.</h3>
                {['Tobi Adeyemi', 'Daniel Okafor'].map((name, index) => (
                  <div className="person-row" key={name}>
                    <span className="avatar">
                      {name[0]}
                      {name.split(' ')[1][0]}
                    </span>
                    <div>
                      <strong>{name}</strong>
                      <small>Arrival recorded · 08:{index ? '42' : '38'}</small>
                    </div>
                    <Check size={19} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section id="dues" className="section container feature-split dues-story">
          <div className="dues-art">
            <div className="paper-label">
              <Wallet size={18} /> A LITTLE PEACE OF MIND
            </div>
            <div className="dues-demo">
              <div className="between">
                <span className="eyebrow">Player monthly history</span>
                <span className="muted">Product demo</span>
              </div>
              <h3>
                YOUR MONTHS.
                <br />
                ALL ACCOUNTED FOR.
              </h3>
              {[
                { month: 'October 2026', status: 'NOT_PAID', note: 'Minimum ₦5,000' },
                { month: 'September 2026', status: 'PAID', note: 'Verified in-app payment' },
                { month: 'August 2026', status: 'PAID', note: 'External payment confirmed' },
              ].map((item) => (
                <div className="dues-demo-row" key={item.month}>
                  <div>
                    <strong>{item.month}</strong>
                    <small>{item.note}</small>
                  </div>
                  <Status value={item.status} />
                </div>
              ))}
              <p className="demo-note">Fictional amounts and payment records.</p>
            </div>
          </div>
          <div>
            <p className="eyebrow">03 / NO MORE “DID I PAY?”</p>
            <h2>
              KNOW WHICH
              <br />
              MONTHS ARE PAID.
            </h2>
            <p>
              Give every player a clear monthly history. Pay in the app, or have management confirm
              a payment made elsewhere. Both belong in the same record.
            </p>
            <div className="plain-list">
              <span>
                <Check size={18} /> A separate record for each month
              </span>
              <span>
                <Check size={18} /> Payment status after confirmation
              </span>
              <span>
                <Check size={18} /> In-app and external payments together
              </span>
            </div>
            <a className="text-action" href="#how-it-works">
              Explore the walkthrough
              <ArrowUpRight size={20} />
            </a>
          </div>
        </section>
        <section className="management-story container">
          <div className="management-photo">
            <Photo />
          </div>
          <div>
            <p className="eyebrow">04 / MADE FOR THE TOUCHLINE</p>
            <h2>
              A CLEAR VIEW FOR
              <br />
              THE PEOPLE
              <br />
              RUNNING THE TEAM.
            </h2>
            <p>
              See who has arrived. Check the month’s dues. Invite your players. Keep the small
              details in order, so your attention stays where it belongs.
            </p>
            <a href="#how-it-works" className="text-action">
              Take a closer look
              <ArrowUpRight size={20} />
            </a>
          </div>
        </section>
        <section className="closing container">
          <p className="eyebrow">BACK TO WHAT BROUGHT YOU HERE</p>
          <h2>
            KEEP THE RECORDS.
            <br />
            <span>GET BACK TO FOOTBALL.</span>
          </h2>
          <ActionLink href={destination}>{action}</ActionLink>
          <p>
            Already have a team? <Link href="/sign-in">Staff sign in</Link>. Players:{' '}
            <Link href="/player/sign-in">sign in here</Link> or ask your coach for an invitation.
          </p>
        </section>
      </main>
      <footer className="site-footer container">
        <div>
          <Logo />
          <p>A little less admin. A lot more football.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#attendance">Attendance</a>
          <a href="#dues">Dues</a>
          <Link href={destination}>{action}</Link>
        </nav>
        <small>
          Photography:{' '}
          <a
            href="https://www.pexels.com/photo/soccer-coach-training-players-on-field-30585023/"
            target="_blank"
            rel="noreferrer"
          >
            Franco Monsalvo
          </a>{' '}
          &amp;{' '}
          <a
            href="https://www.pexels.com/photo/soccer-coach-giving-tactical-instructions-outdoors-30314825/"
            target="_blank"
            rel="noreferrer"
          >
            Ali Bensoula
          </a>{' '}
          / Pexels
        </small>
      </footer>
    </>
  );
}
