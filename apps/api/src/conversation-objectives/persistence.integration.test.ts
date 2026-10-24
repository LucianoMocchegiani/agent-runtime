import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../db/prisma.js';
import { ConversationNotFoundError } from '../conversations/errors.js';
import { getConversationObjective, saveConversationObjective } from './persistence.js';

 test('persists one objective, replaces stale progress and isolates its owner', { skip: !process.env.DATABASE_URL }, async () => {
  const userId = `objective-test-${randomUUID()}`;
  const otherUserId = `objective-test-${randomUUID()}`;
  const conversation = await prisma.conversation.create({ data: { userId } });
  const otherConversation = await prisma.conversation.create({ data: { userId: otherUserId } });
  try {
    assert.equal(await getConversationObjective(conversation.id, userId), null);
    const initial = await saveConversationObjective(conversation.id, userId, {
      title: 'Preparar propuesta', description: 'Entregar propuesta revisada', status: 'active',
      steps: [{ id: 'draft', description: 'Redactar borrador', status: 'in_progress' }],
      nextStep: 'Revisar costos', expectedRevision: null,
    });
    assert.ok(initial.objective);
    const objectiveId = initial.objective.id;

    const changed = await saveConversationObjective(conversation.id, userId, {
      title: 'Preparar presupuesto', description: 'Entregar presupuesto aprobado', status: 'blocked',
      steps: [{ id: 'approval', description: 'Esperar aprobación', status: 'pending' }],
      nextStep: 'Solicitar aprobación', expectedRevision: initial.objective.revision,
    });
    assert.equal(changed.objective?.id, objectiveId);
    assert.deepEqual(changed.objective?.steps.map(({ id }) => id), ['approval']);
    assert.equal(changed.objective?.status, 'blocked');

    const concurrent = await Promise.all([
      saveConversationObjective(conversation.id, userId, {
        title: 'Presupuesto A', description: 'Versión A', status: 'active', steps: [], nextStep: null, expectedRevision: changed.objective!.revision,
      }),
      saveConversationObjective(conversation.id, userId, {
        title: 'Presupuesto B', description: 'Versión B', status: 'active', steps: [], nextStep: null, expectedRevision: changed.objective!.revision,
      }),
    ]);
    assert.equal(concurrent.filter(({ objective }) => objective).length, 1);
    assert.equal(concurrent.filter(({ error }) => error).length, 1);

    const stored = await getConversationObjective(conversation.id, userId);
    assert.equal(stored?.id, objectiveId);
    assert.equal(stored?.revision, changed.objective!.revision + 1);
    assert.equal(await getConversationObjective(otherConversation.id, otherUserId), null);
    await assert.rejects(getConversationObjective(conversation.id, otherUserId), ConversationNotFoundError);
    await assert.rejects(saveConversationObjective(conversation.id, otherUserId, {
      title: 'No autorizado', description: 'No debe guardarse', status: 'active', steps: [], nextStep: null, expectedRevision: null,
    }), ConversationNotFoundError);
  } finally {
    await prisma.conversation.deleteMany({ where: { id: { in: [conversation.id, otherConversation.id] } } });
  }
});
