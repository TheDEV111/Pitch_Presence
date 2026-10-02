import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const key = (secret: string) => createHash('sha256').update(`email-job:${secret}`).digest();
export function encrypt(secret: string, value: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(secret), iv);
  const encrypted = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), encrypted]).toString('base64');
}
export function decrypt(secret: string, value: string) {
  const b = Buffer.from(value, 'base64');
  const c = createDecipheriv('aes-256-gcm', key(secret), b.subarray(0, 12));
  c.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString('utf8');
}
