import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearStoredBearerToken,
  getStoredBearerToken,
  hasStoredBearerToken,
  normalizeBearerToken,
  setStoredBearerToken,
} from './authToken.js';

function withSessionStorage(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const data = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, String(value)),
      removeItem: key => data.delete(key),
    },
  });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else delete globalThis.sessionStorage;
  }
}

test('normaliza tokens pegados con o sin el prefijo Bearer', () => {
  assert.equal(normalizeBearerToken('  Bearer abc.def  '), 'abc.def');
  assert.equal(normalizeBearerToken('abc.def'), 'abc.def');
  assert.throws(() => normalizeBearerToken('Bearer '), /Pegá un Bearer token/);
  assert.throws(() => normalizeBearerToken('token en dos partes'), /no puede contener espacios/);
});

test('guarda y borra el Bearer en el almacenamiento de sesión', () => withSessionStorage(() => {
  assert.equal(getStoredBearerToken(), null);
  assert.equal(hasStoredBearerToken(), false);
  setStoredBearerToken('Bearer test-token');
  assert.equal(getStoredBearerToken(), 'test-token');
  assert.equal(hasStoredBearerToken(), true);
  clearStoredBearerToken();
  assert.equal(getStoredBearerToken(), null);
  assert.equal(hasStoredBearerToken(), false);
}));
