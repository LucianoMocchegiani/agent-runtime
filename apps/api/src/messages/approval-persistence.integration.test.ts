import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../db/prisma.js';
import {
  claimPendingToolApproval,
  finishPendingToolApproval,
  getPendingToolApproval,
} from './approval-persistence.js';

test('claims a stored approval once and persists its MCP result', { skip: !process.env.DATABASE_URL }, async () => {
  const userId = `approval-test-${randomUUID()}`;
  const conversation = await prisma.conversation.create({ data: { userId } });
  try {
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'tool',
        toolName: 'mcp__change',
        toolArgs: { recordId: 'record-1' },
        toolResult: { state: 'approval_pending' },
        content: 'Waiting for confirmation',
      },
    });
    const pending = await getPendingToolApproval(conversation.id, userId, message.id);
    assert.deepEqual(pending.toolArgs, { recordId: 'record-1' });

    const claims = await Promise.all([
      claimPendingToolApproval(conversation.id, message.id),
      claimPendingToolApproval(conversation.id, message.id),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);

    const result = { content: [{ type: 'text', text: 'updated' }] };
    await finishPendingToolApproval(conversation.id, message.id, result);
    const stored = await prisma.message.findUnique({ where: { id: message.id }, select: { toolResult: true } });
    assert.deepEqual(stored?.toolResult, result);
    assert.equal(await claimPendingToolApproval(conversation.id, message.id), false);
  } finally {
    await prisma.conversation.delete({ where: { id: conversation.id } });
  }
});
