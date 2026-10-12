import assert from 'node:assert/strict';
import test from 'node:test';
import { openDelegationPayload, sealDelegationPayload } from './payload.js';

const KEY = 'ab'.repeat(32);

test('cifra y descifra payloads con AES-256-GCM', () => {
  const previous = process.env.DELEGATION_PAYLOAD_ENCRYPTION_KEY;
  process.env.DELEGATION_PAYLOAD_ENCRYPTION_KEY = KEY;
  try {
    const original = { accessToken: 'secret-token', instruction: 'hacé el trabajo' };
    const sealed = sealDelegationPayload(original);
    assert.notEqual(sealed.ciphertext.toString('utf8'), JSON.stringify(original));
    assert.deepEqual(openDelegationPayload<typeof original>(sealed), original);
  } finally {
    if (previous === undefined) delete process.env.DELEGATION_PAYLOAD_ENCRYPTION_KEY;
    else process.env.DELEGATION_PAYLOAD_ENCRYPTION_KEY = previous;
  }
});

test('rechaza claves inválidas y payloads alterados', () => {
  const previous = process.env.DELEGATION_PAYLOAD_ENCRYPTION_KEY;
  process.env.DELEGATION_PAYLOAD_ENCRYPTION_KEY = 'invalid';
  try {
    assert.throws(() => sealDelegationPayload({ secret: true }), /64 caracteres hexadecimales/);
    process.env.DELEGATION_PAYLOAD_ENCRYPTION_KEY = KEY;
    const sealed = sealDelegationPayload({ secret: true });
    sealed.ciphertext[0] = (sealed.ciphertext[0] ?? 0) ^ 0xff;
    assert.throws(() => openDelegationPayload(sealed));
  } finally {
    if (previous === undefined) delete process.env.DELEGATION_PAYLOAD_ENCRYPTION_KEY;
    else process.env.DELEGATION_PAYLOAD_ENCRYPTION_KEY = previous;
  }
});
