import { readFile, writeFile, chmod } from 'node:fs/promises';
import { createECDH } from 'node:crypto';
const path = new URL('../.env', import.meta.url);
let env;
try {
  env = await readFile(path, 'utf8');
} catch {
  throw new Error('Create the root .env from .env.example first.');
}
const existing = (name) => env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
if (existing('VAPID_PUBLIC_KEY') || existing('VAPID_PRIVATE_KEY')) {
  console.log(
    'Push keys already exist. They were preserved; use the same pair on the API and worker.',
  );
} else {
  const sender = existing('EMAIL_FROM')?.match(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  )?.[0];
  const contact = process.argv[2] ?? (sender ? `mailto:${sender}` : undefined);
  if (!contact || !/^mailto:[^\s@]+@[^\s@]+$/.test(contact))
    throw new Error('Usage: npm run push:setup -- mailto:your-contact@your-domain.com');
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const settings = {
    VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'),
    VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url'),
    VAPID_SUBJECT: contact,
  };
  for (const [name, value] of Object.entries(settings)) {
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    env = pattern.test(env)
      ? env.replace(pattern, `${name}=${value}`)
      : `${env.trimEnd()}\n${name}=${value}\n`;
  }
  await writeFile(path, env, { mode: 0o600 });
  await chmod(path, 0o600);
  console.log(
    'Generated push keys in the ignored root .env. No keys were printed. Restart the API and worker.',
  );
}
