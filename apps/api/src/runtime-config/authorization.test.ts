import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { config } from '../config.js';
import { clearAuthCache } from '../auth/service.js';
import { prisma } from '../db/prisma.js';
import { Hono } from 'hono';
import { ACCESS_COOKIE_NAME } from '../auth/constants.js';
import { authorized, authorizedAdminRequest } from './authorization.js';

const originalFetch = globalThis.fetch;
const originalIntrospectUrl = config.authIntrospectUrl;
const originalAuthMapping = config.authMapping;
const originalFindUnique = prisma.runtimeAdmin.findUnique;
const originalFallbackUsername = process.env.RUNTIME_ADMIN_USERNAME;
const originalFallbackPassword = process.env.RUNTIME_ADMIN_PASSWORD;
let allowAdmin = true;

before(() => {
  delete process.env.RUNTIME_ADMIN_USERNAME;
  delete process.env.RUNTIME_ADMIN_PASSWORD;
  config.authIntrospectUrl = 'https://auth.example.test/introspect';
  config.authMapping = { userId: 'sub', email: 'email', name: 'name' };
  prisma.runtimeAdmin.findUnique = (async ({ where }: { where: { userId: string } }) =>
    allowAdmin && where.userId === 'user-123' ? { userId: where.userId, createdAt: new Date(), createdByUserId: null } : null
  ) as unknown as typeof originalFindUnique;
  globalThis.fetch = async () => new Response(JSON.stringify({ sub: 'user-123', email: 'admin@example.com' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

after(() => {
  globalThis.fetch = originalFetch;
  config.authIntrospectUrl = originalIntrospectUrl;
  config.authMapping = originalAuthMapping;
  prisma.runtimeAdmin.findUnique = originalFindUnique;
  if (originalFallbackUsername === undefined) delete process.env.RUNTIME_ADMIN_USERNAME;
  else process.env.RUNTIME_ADMIN_USERNAME = originalFallbackUsername;
  if (originalFallbackPassword === undefined) delete process.env.RUNTIME_ADMIN_PASSWORD;
  else process.env.RUNTIME_ADMIN_PASSWORD = originalFallbackPassword;
  clearAuthCache();
});

test('authorizes only verified IDs present in the persistent admin store', async () => {
  clearAuthCache();
  allowAdmin = true;
  assert.equal(await authorized('Bearer user-token'), true);
  allowAdmin = false;
  assert.equal(await authorized('Bearer second-user-token'), false);
});

test('cookie session authorizes a registered admin only from a trusted browser origin', async () => {
  clearAuthCache();
  allowAdmin = true;
  const app = new Hono();
  app.get('/admin', async (c) => c.json({ authorized: Boolean(await authorizedAdminRequest(c)) }));
  const cookie = `${ACCESS_COOKIE_NAME}=user-token`;

  const sameOrigin = await app.request('/admin', {
    headers: { Cookie: cookie, Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.deepEqual(await sameOrigin.json(), { authorized: true });

  const crossOrigin = await app.request('/admin', {
    headers: { Cookie: cookie, Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.deepEqual(await crossOrigin.json(), { authorized: false });

  const missingOrigin = await app.request('/admin', { headers: { Cookie: cookie } });
  assert.deepEqual(await missingOrigin.json(), { authorized: false });

  allowAdmin = false;
  clearAuthCache();
  const revokedAdmin = await app.request('/admin', {
    headers: { Cookie: cookie, Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.deepEqual(await revokedAdmin.json(), { authorized: false });
});

test('fallback admin works independently of dynamic auth and admin list', async () => {
  config.authIntrospectUrl = null;
  allowAdmin = false;
  const authorization = `Basic ${Buffer.from('admin:admin').toString('base64')}`;
  assert.equal(await authorized(authorization), true);
  assert.equal(await authorized(`Basic ${Buffer.from('wrong:credentials').toString('base64')}`), false);

  const app = new Hono();
  app.get('/admin', async (c) => c.json({ authorized: Boolean(await authorizedAdminRequest(c)) }));
  const behindTlsProxy = await app.request('/admin', {
    headers: { Authorization: authorization, Origin: 'https://runtime.example', 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.deepEqual(await behindTlsProxy.json(), { authorized: true });

  const crossSite = await app.request('/admin', {
    headers: { Authorization: authorization, Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.deepEqual(await crossSite.json(), { authorized: false });
});

test('fallback credentials can be overridden with environment variables', async () => {
  process.env.RUNTIME_ADMIN_USERNAME = 'ops';
  process.env.RUNTIME_ADMIN_PASSWORD = 'secure:password';
  assert.equal(await authorized(`Basic ${Buffer.from('ops:secure:password').toString('base64')}`), true);
  assert.equal(await authorized(`Basic ${Buffer.from('admin:admin').toString('base64')}`), false);
});

test('does not accept anonymous tokens or missing headers', async () => {
  assert.equal(await authorized('Bearer anon:123'), false);
  assert.equal(await authorized(undefined), false);
});

test('fails closed when identity introspection is not configured', async () => {
  config.authIntrospectUrl = null;
  assert.equal(await authorized('Bearer unresolvable-token'), false);
  config.authIntrospectUrl = 'https://auth.example.test/introspect';
});
