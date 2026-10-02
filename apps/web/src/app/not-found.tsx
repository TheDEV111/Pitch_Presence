import Link from 'next/link';
export default function NotFound() {
  return (
    <main id="main" className="not-found">
      <p className="eyebrow">Wrong side of the touchline</p>
      <h1>Page not found.</h1>
      <p>Let’s get you back to your team.</p>
      <Link className="button primary" href="/">
        Back to home
      </Link>
    </main>
  );
}
