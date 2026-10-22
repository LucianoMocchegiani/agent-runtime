import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { config } from '../config.js';
import { requirePrincipal } from './middleware.js';
import type { AppEnv } from './contracts.js';

type ResponseBody = {
  principal: { userId: string; email: string | null; name: string | null };
  accessToken: string;
};

const app = new Hono<AppEnv>();
app.use('/protected', requirePrincipal);
app.get('/protected', (c) =>
  c.json({ principal: c.get('principal'), accessToken: c.get('accessToken') }),
);

test('without introspection, opaque Bearer requests are rejected', async () => {
  const previousUrl = config.authIntrospectUrl;
  config.authIntrospectUrl = null;
  try {
    const response = await app.request('/protected', {
      headers: { Authorization: 'Bearer opaque-host-token' },
    });

    assert.equal(response.status, 401);
    assert.equal(await response.text(), 'Bearer authentication is not configured');
  } finally {
    config.authIntrospectUrl = previousUrl;
  }
});

test('without introspection, requests without Bearer remain public', async () => {
  const previousUrl = config.authIntrospectUrl;
  config.authIntrospectUrl = null;
  try {
    const response = await app.request('/protected');
    const body = (await response.json()) as ResponseBody;

    assert.equal(response.status, 200);
    assert.match(body.principal.userId, /^[0-9a-f-]{36}$/i);
    assert.equal(body.principal.email, null);
    assert.equal(body.principal.name, null);
    assert.equal(body.accessToken, '');
  } finally {
    config.authIntrospectUrl = previousUrl;
  }
});

test('anonymous UUID Bearer stays stable in public mode', async () => {
  const previousUrl = config.authIntrospectUrl;
  config.authIntrospectUrl = null;
  try {
    const response = await app.request('/protected', {
      headers: { Authorization: 'Bearer anon:stable-session-id' },
    });
    const body = (await response.json()) as ResponseBody;

    assert.equal(response.status, 200);
    assert.equal(body.principal.userId, 'stable-session-id');
  } finally {
    config.authIntrospectUrl = previousUrl;
  }
});
