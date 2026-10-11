import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireConversationTurn } from './turn-lock.js';

test('bloquea turnos simultáneos en el mismo hilo y libera al terminar', () => {
  const release = acquireConversationTurn('user-a', 'conversation-a');
  assert.equal(typeof release, 'function');
  assert.equal(acquireConversationTurn('user-a', 'conversation-a'), null);

  release?.();
  assert.equal(typeof acquireConversationTurn('user-a', 'conversation-a'), 'function');
});

test('permite turnos en otros hilos y para otros usuarios', () => {
  const releaseA = acquireConversationTurn('user-b', 'conversation-a');
  const releaseB = acquireConversationTurn('user-a', 'conversation-b');
  assert.equal(typeof releaseA, 'function');
  assert.equal(typeof releaseB, 'function');
  releaseA?.();
  releaseB?.();
});

test('la función de liberación es idempotente', () => {
  const release = acquireConversationTurn('user-c', 'conversation-c');
  release?.();
  release?.();
  const nextRelease = acquireConversationTurn('user-c', 'conversation-c');
  assert.equal(typeof nextRelease, 'function');
  nextRelease?.();
});
