'use client';
import Link from 'next/link';
import { ArrowUpRight, CircleCheck, LoaderCircle } from 'lucide-react';
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react';

export function Logo() {
  return (
    <Link href="/" className="wordmark" aria-label="PitchPresence home">
      <svg viewBox="0 0 32 38" width="28" height="34" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="26" height="32" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M3 19h26M11 3v6h10V3M11 35v-6h10v6" stroke="currentColor" strokeWidth="2" />
        <circle cx="16" cy="19" r="5" stroke="currentColor" strokeWidth="2" />
        <circle cx="16" cy="19" r="2" fill="currentColor" />
      </svg>
      PitchPresence<span className="brand-period">.</span>
    </Link>
  );
}
export function Button({
  children,
  busy,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${variant} ${props.className ?? ''}`}
    >
      {busy && <LoaderCircle className="spinner" size={18} />} {children}
    </button>
  );
}
export function ActionLink({
  href,
  children,
  secondary = false,
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <Link className={`button ${secondary ? 'secondary' : 'primary'}`} href={href}>
      {children}
      <ArrowUpRight size={18} />
    </Link>
  );
}
export function Field({
  label,
  help,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; help?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
      {help && <small>{help}</small>}
    </label>
  );
}
export function Feedback({ error, success }: { error?: string | null; success?: string | null }) {
  return (
    <>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="notice success" role="status">
          <CircleCheck size={18} />
          {success}
        </div>
      )}
    </>
  );
}
export function Status({ value }: { value: string }) {
  const good = ['PAID', 'PRESENT', 'SUCCESS', 'OPEN', 'ACTIVE'].includes(value);
  return (
    <span className={`status ${good ? 'good' : ''}`}>
      <span className="status-dot" />
      {(
        {
          NOT_PAID: 'Not paid',
          NOT_CHECKED_IN: 'Not checked in',
          PENDING: 'Payment pending',
        } as Record<string, string>
      )[value] ?? value.charAt(0) + value.slice(1).toLowerCase()}
    </span>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spinner" size={24} /> Loading your team…
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <span className="eyebrow">A fresh start</span>
      <p>{children}</p>
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-title">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}
