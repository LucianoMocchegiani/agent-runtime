import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { openOAuthToken, sealOAuthToken } from './crypto.js';

const KEY_ENV = 'MCP_OAUTH_ENCRYPTION_KEY';

test('OAuth tokens are encrypted with authenticated AES-256-GCM', () => {
  const previous = process.env[KEY_ENV];
  process.env[KEY_ENV] = randomBytes(32).toString('hex');
  try {
    const sealed = sealOAuthToken('gho-secret-token');
    assert.notEqual(sealed.ciphertext.toString('utf8'), 'gho-secret-token');
    assert.equal(openOAuthToken(sealed), 'gho-secret-token');
    sealed.ciphertext[0] ^= 1;
    assert.throws(() => openOAuthToken(sealed));
  } finally {
    if (previous === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = previous;
  }
});

test('OAuth token encryption rejects missing or malformed keys', () => {
  const previous = process.env[KEY_ENV];
  try {
    delete process.env[KEY_ENV];
    assert.throws(() => sealOAuthToken('token'), /MCP_OAUTH_ENCRYPTION_KEY/);
    process.env[KEY_ENV] = 'nope';
    assert.throws(() => sealOAuthToken('token'), /MCP_OAUTH_ENCRYPTION_KEY/);
  } finally {
    if (previous === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = previous;
  }
});
