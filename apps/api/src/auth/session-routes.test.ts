import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { config } from '../config.js';
import type { AppEnv } from './contracts.js';
import { requirePrincipal } from './middleware.js';
import { ACCESS_COOKIE_NAME, authSessionRoutes } from './session-routes.js';

const app = new Hono<AppEnv>();
app.route('/auth', authSessionRoutes);
app.use('/protected', requirePrincipal);
app.get('/protected', (c) => c.json({ principal: c.get('principal'), accessToken: c.get('accessToken') }));

test('session endpoint sets an HttpOnly cookie and cookie auth overrides anonymous client identity', async () => {
  const previousUrl = config.authIntrospectUrl;
  const previousFetch = globalThis.fetch;
  const previousNodeEnv = process.env.NODE_ENV;
  config.authIntrospectUrl = 'https://issuer.example/userinfo';
  process.env.NODE_ENV = 'test';
  globalThis.fetch = async () => new Response(JSON.stringify({ userId: 'user-123', email: 'user@example.com' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    const login = await app.request('/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
      body: JSON.stringify({ token: 'opaque-token' }),
    });
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), { authenticated: true });
    const setCookie = login.headers.get('set-cookie') ?? '';
    assert.match(setCookie, new RegExp(`${ACCESS_COOKIE_NAME}=opaque-token`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//i);

    const protectedResponse = await app.request('/protected', {
      headers: {
        Authorization: 'Bearer anon:stable-anonymous-id',
        Cookie: `${ACCESS_COOKIE_NAME}=opaque-token`,
        Origin: 'http://localhost',
      },
    });
    assert.equal(protectedResponse.status, 200);
    const protectedBody = await protectedResponse.json() as { principal: { userId: string }; accessToken: string };
    assert.equal(protectedBody.principal.userId, 'user-123');
    assert.equal(protectedBody.accessToken, 'opaque-token');

    const csrfAttempt = await app.request('/protected', {
      headers: { Cookie: `${ACCESS_COOKIE_NAME}=opaque-token`, Origin: 'https://attacker.example' },
    });
    assert.equal(csrfAttempt.status, 403);

    const missingOrigin = await app.request('/protected', {
      headers: { Cookie: `${ACCESS_COOKIE_NAME}=opaque-token` },
    });
    assert.equal(missingOrigin.status, 403);

    const logout = await app.request('/auth/session', {
      method: 'DELETE',
      headers: { Cookie: `${ACCESS_COOKIE_NAME}=opaque-token`, Origin: 'http://localhost' },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/i);
  } finally {
    config.authIntrospectUrl = previousUrl;
    globalThis.fetch = previousFetch;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
