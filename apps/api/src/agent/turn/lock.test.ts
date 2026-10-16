import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationTurnLocker } from './lock.js';

type Entry = { token: string; expiresAt: number };

function fakeStore() {
  const entries = new Map<string, Entry>();
  const key = (userId: string, conversationId: string) => JSON.stringify([userId, conversationId]);
  return {
    entries,
    async claim(userId: string, conversationId: string, token: string, leaseMs: number) {
      const id = key(userId, conversationId);
      const existing = entries.get(id);
      if (existing && existing.expiresAt > Date.now()) return false;
      entries.set(id, { token, expiresAt: Date.now() + leaseMs });
      return true;
    },
    async renew(userId: string, conversationId: string, token: string, leaseMs: number) {
      const entry = entries.get(key(userId, conversationId));
      if (!entry || entry.token !== token || entry.expiresAt <= Date.now()) return false;
      entry.expiresAt = Date.now() + leaseMs;
      return true;
    },
    async release(userId: string, conversationId: string, token: string) {
      const id = key(userId, conversationId);
      if (entries.get(id)?.token === token) entries.delete(id);
    },
  };
}

test('dos lockers con store compartido no adquieren el mismo hilo simultáneamente', async () => {
  const store = fakeStore();
  const instanceA = createConversationTurnLocker(store);
  const instanceB = createConversationTurnLocker(store);

  const lease = await instanceA('user-a', 'conversation-a');
  assert.ok(lease);
  assert.equal(await instanceB('user-a', 'conversation-a'), null);

  await lease.release();
  const nextLease = await instanceB('user-a', 'conversation-a');
  assert.ok(nextLease);
  await nextLease.release();
});

test('permite turnos en otros hilos y para otros usuarios', async () => {
  const locker = createConversationTurnLocker(fakeStore());
  const leaseA = await locker('user-a', 'conversation-a');
  const leaseB = await locker('user-a', 'conversation-b');
  const leaseC = await locker('user-b', 'conversation-a');
  assert.ok(leaseA && leaseB && leaseC);
  await Promise.all([leaseA.release(), leaseB.release(), leaseC.release()]);
});

test('la liberación es idempotente y solo elimina el lease que posee', async () => {
  const store = fakeStore();
  const locker = createConversationTurnLocker(store, { leaseMs: 100, renewEveryMs: 25 });
  const oldLease = await locker('user-a', 'conversation-a');
  assert.ok(oldLease);
  // Simula que otro propietario tomó el lease después de que el anterior venció.
  const owner = store.entries.get(JSON.stringify(['user-a', 'conversation-a']));
  assert.ok(owner);
  owner.expiresAt = Date.now() - 1;
  const replacement = await locker('user-a', 'conversation-a');
  assert.ok(replacement);

  await oldLease.release();
  assert.equal(store.entries.size, 1);
  await replacement.release();
  await replacement.release();
  assert.equal(store.entries.size, 0);
});

test('renueva el lease y aborta si el store informa que se perdió', async () => {
  const store = fakeStore();
  let renewCount = 0;
  const locker = createConversationTurnLocker({
    ...store,
    async renew() {
      renewCount += 1;
      return false;
    },
  }, { leaseMs: 100, renewEveryMs: 20 });
  const lease = await locker('user-a', 'conversation-a');
  assert.ok(lease);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(renewCount > 0);
  assert.equal(lease.signal.aborted, true);
  await lease.release();
});
