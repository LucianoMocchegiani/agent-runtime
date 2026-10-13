import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeConversationCursor,
  encodeConversationCursor,
  type ConversationListScope,
} from './conversation-cursor.js';

const cursorData = {
  updatedAt: '2025-01-02T03:04:05.000Z',
  id: '123e4567-e89b-42d3-a456-426614174000',
};

test('conversation cursor round-trips its pagination key and scope', () => {
  const cursor = encodeConversationCursor({ ...cursorData, scope: 'all' });
  assert.deepEqual(decodeConversationCursor(cursor, 'all'), cursorData);
});

test('conversation cursor cannot be reused with a different filter', () => {
  const cursor = encodeConversationCursor({ ...cursorData, scope: 'active' });
  assert.throws(() => decodeConversationCursor(cursor, 'archived'), /cursor de conversaciones/);
});

test('conversation cursor rejects malformed timestamps and identifiers', () => {
  for (const payload of [
    { updatedAt: 'not-a-date', id: cursorData.id, scope: 'all' },
    { updatedAt: cursorData.updatedAt, id: 'not-a-uuid', scope: 'all' },
  ]) {
    const cursor = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    assert.throws(() => decodeConversationCursor(cursor, 'all'), /cursor de conversaciones/);
  }
});

test('conversation scope accepts only supported values at the tool boundary', () => {
  const scopes: ConversationListScope[] = ['all', 'active', 'archived'];
  for (const scope of scopes) {
    const cursor = encodeConversationCursor({ ...cursorData, scope });
    assert.deepEqual(decodeConversationCursor(cursor, scope), cursorData);
  }
});
