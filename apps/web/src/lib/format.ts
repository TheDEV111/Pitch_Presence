export function money(kobo: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: kobo % 100 ? 2 : 0,
  }).format(kobo / 100);
}
export function parseMoney(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error('Enter an amount in naira, with at most two decimal places.');
  const [whole, fraction = ''] = value.trim().split('.');
  const kobo = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(kobo) || kobo < 1 || kobo > 2_000_000_000)
    throw new Error('Enter an amount between ₦0.01 and ₦20,000,000.');
  return kobo;
}
export function currentMonth(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
  }).format(date);
}
export function monthLabel(month: string) {
  return new Intl.DateTimeFormat('en-NG', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  }).format(new Date(`${month}-01T12:00:00Z`));
}
export function dateLabel(value: string, time = false) {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    ...(time ? { hour: 'numeric', minute: '2-digit' } : { year: 'numeric' }),
  }).format(new Date(value));
}
export function safeReturn(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : null;
}
