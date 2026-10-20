import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { expect, it } from 'vitest';
import { InvitationContinuation } from '../../src/modules/invitations/continuation.js';
import type { Config } from '../../src/config/index.js';
it('issues bounded HttpOnly Secure cookies in production without revealing the invitation', async () => {
  const app = Fastify();
  await app.register(cookie);
  const helper = new InvitationContinuation({
    NODE_ENV: 'production',
    DATA_ENCRYPTION_SECRET: 'test-only-invitation-data-secret-00000000',
  } as Config);
  app.get('/', (request, reply) =>
    helper.issue(
      request,
      reply,
      'test-invitation-token-with-at-least-32-characters',
      new Date(Date.now() + 86400000),
    ),
  );
  try {
    const result = await app.inject('/');
    expect(result.headers['set-cookie']).toContain('__Secure-pp-join-');
    expect(result.headers['set-cookie']).toContain('HttpOnly');
    expect(result.headers['set-cookie']).toContain('; Secure');
    expect(result.headers['set-cookie']).toContain('SameSite=Lax');
    expect(result.headers['set-cookie']).toContain('Path=/api/v1');
    expect(result.body).not.toContain('test-invitation-token');
    expect(Date.parse(result.json().contextExpiresAt) - Date.now()).toBeLessThanOrEqual(1800000);
    const jar = new Map<string, string>();
    let latest = result;
    for (let i = 0; i < 6; i++) {
      const headers = latest.headers['set-cookie'];
      for (const header of Array.isArray(headers) ? headers : [String(headers)]) {
        const pair = header.split(';')[0]!;
        const name = pair.slice(0, pair.indexOf('='));
        if (/Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(header)) jar.delete(name);
        else jar.set(name, pair);
      }
      expect(jar.size).toBeLessThanOrEqual(5);
      latest = await app.inject({ url: '/', headers: { cookie: [...jar.values()].join('; ') } });
    }
    expect(jar.size).toBe(5);
  } finally {
    await app.close();
  }
});
