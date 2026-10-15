import assert from 'node:assert/strict';
import test from 'node:test';
import { HTTPException } from 'hono/http-exception';
import { readJsonBody } from './request-body.js';

test('parsea JSON UTF-8 dentro del límite de bytes', async () => {
  const request = new Request('http://runtime.test/messages', {
    method: 'POST',
    body: JSON.stringify({ text: 'hola, ñ' }),
  });
  assert.deepEqual(await readJsonBody(request, 100), { text: 'hola, ñ' });
});

test('rechaza cuerpos que exceden el límite aun sin Content-Length', async () => {
  const request = new Request('http://runtime.test/messages', {
    method: 'POST',
    body: new Blob(['1234567890']),
  });
  assert.equal(request.headers.get('content-length'), null);
  await assert.rejects(readJsonBody(request, 5), (error: unknown) =>
    error instanceof HTTPException && error.status === 413,
  );
});

test('rechaza JSON inválido y UTF-8 malformado como solicitudes 400', async () => {
  const invalidJson = new Request('http://runtime.test/messages', { method: 'POST', body: '{' });
  await assert.rejects(readJsonBody(invalidJson, 10), (error: unknown) =>
    error instanceof HTTPException && error.status === 400,
  );

  const invalidUtf8 = new Request('http://runtime.test/messages', {
    method: 'POST',
    body: new Uint8Array([0xff]),
  });
  await assert.rejects(readJsonBody(invalidUtf8, 10), (error: unknown) =>
    error instanceof HTTPException && error.status === 400,
  );
});

test('permite cuerpo vacío por defecto y puede exigir JSON', async () => {
  const empty = new Request('http://runtime.test/preferences', { method: 'POST' });
  assert.deepEqual(await readJsonBody(empty), {});

  const required = new Request('http://runtime.test/preferences', { method: 'POST' });
  await assert.rejects(readJsonBody(required, undefined, { allowEmpty: false }), (error: unknown) =>
    error instanceof HTTPException && error.status === 400,
  );
});
