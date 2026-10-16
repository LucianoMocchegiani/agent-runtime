import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeOptionalPreferenceCursor, encodePreferenceCursor } from './cursor.js';

const value = {
  createdAt: '2026-05-20T12:30:00.123456Z',
  id: '9a818762-2e32-4b2f-8d93-5db42cb4fb05',
};

test('preference cursor round-trips its timestamp and identifier', () => {
  const cursor = encodePreferenceCursor(value);
  assert.deepEqual(decodeOptionalPreferenceCursor(cursor), value);
});

test('omitted and blank preference cursors start at the first page', () => {
  assert.equal(decodeOptionalPreferenceCursor(undefined), undefined);
  assert.equal(decodeOptionalPreferenceCursor('  '), undefined);
});

test('invalid preference cursors are rejected', () => {
  assert.throws(() => decodeOptionalPreferenceCursor('not-a-cursor'), /cursor de preferencias/);
  const wrongScope = Buffer.from(JSON.stringify({ ...value, scope: 'conversations' }), 'utf8').toString('base64url');
  assert.throws(() => decodeOptionalPreferenceCursor(wrongScope), /cursor de preferencias/);
});
