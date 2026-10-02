import { notFound } from 'next/navigation';
import { Application } from '@/components/application';
export const metadata = { title: 'Your team', robots: { index: false, follow: false } };
const paths = new Set([
  'sign-in',
  'signup',
  'player/sign-in',
  'staff/join',
  'verify-email',
  'forgot-password',
  'onboarding/team',
  'onboarding/staff-invitation',
  'management/team',
  'register',
  'reset-pin',
  'check-in',
  'home',
  'attendance',
  'dues',
  'dues/payment-return',
  'account',
  'management',
  'management/training',
  'management/players',
  'management/dues',
  'management/audit',
]);
export default async function AppPage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const route = path.join('/');
  if (!paths.has(route) && !/^management\/training\/[0-9a-f-]{36}$/.test(route)) notFound();
  return <Application key={route} route={route} />;
}
