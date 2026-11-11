import type { NextConfig } from 'next';

const staging = process.env.NEXT_PUBLIC_APP_ENV === 'staging';
if (staging && process.env.API_URL !== 'https://staging-api.kairos-devs.com')
  throw new Error('Staging frontend requires its staging API_URL');

const config: NextConfig = {
  poweredByHeader: false,
  experimental: { cpus: 1, useTypeScriptCli: false },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL ?? 'http://127.0.0.1:4000'}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      {
        source: '/:path*',
        headers: [
          ...(staging ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }] : []),
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default config;
