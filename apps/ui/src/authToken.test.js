import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearStoredBearerToken,
  getAuthSession,
  normalizeBearerToken,
  setStoredBearerToken,
} from './authToken.js';

test('normaliza tokens pegados con o sin el prefijo Bearer', () => {
  assert.equal(normalizeBearerToken('  Bearer abc.def  '), 'abc.def');
  assert.equal(normalizeBearerToken('abc.def'), 'abc.def');
  assert.throws(() => normalizeBearerToken('Bearer '), /Pegá un Bearer token/);
  assert.throws(() => normalizeBearerToken('token en dos partes'), /no puede contener espacios/);
});

test('guarda el token en el servidor con credenciales y consulta la sesión sin leer la cookie', async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ authenticated: true }), { status: 200 });
  };
  try {
    await setStoredBearerToken('Bearer test-token');
    assert.deepEqual(await getAuthSession(), { authenticated: true });
    await clearStoredBearerToken();

    assert.equal(requests[0].url, '/auth/session');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.credentials, 'include');
    assert.deepEqual(JSON.parse(requests[0].options.body), { token: 'test-token' });
    assert.equal(requests[0].options.headers.Authorization, undefined);
    assert.equal(requests[1].options.method, 'GET');
    assert.equal(requests[2].options.method, 'DELETE');
    assert.equal(requests[2].options.credentials, 'include');
    assert.equal(requests[2].options.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
