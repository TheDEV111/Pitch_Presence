import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PwaRuntime } from '@/components/pwa';
export const metadata: Metadata = {
  title: { default: 'PitchPresence — More football. Less admin.', template: '%s | PitchPresence' },
  description:
    'Keep training attendance and monthly dues in one place, so you can focus on the team.',
  applicationName: 'PitchPresence',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'PitchPresence', statusBarStyle: 'default' },
  robots: { index: true, follow: true },
};
export const viewport: Viewport = { themeColor: '#195C3C', width: 'device-width', initialScale: 1 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {process.env.NODE_ENV !== 'production' &&
          process.env.NEXT_PUBLIC_LOCAL_FONTS !== 'true' && (
            <link
              rel="stylesheet"
              href="https://fonts.googleapis.com/css2?family=Antonio:wght@700&family=Inter:wght@400;500;600;700;800&display=swap"
            />
          )}
      </head>
      <body data-local-fonts={process.env.NEXT_PUBLIC_LOCAL_FONTS === 'true' ? 'true' : undefined}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
        <PwaRuntime />
      </body>
    </html>
  );
}
