import { Prisma } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';
import { prisma } from '../db/prisma.js';
import { assertConversationOwner } from '../conversations/access.js';
import { shrinkToolContent } from '../agent/window/index.js';

export type PendingToolApproval = { id: string; toolName: string; toolArgs: unknown };

function isPending(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (value as { state?: unknown }).state === 'approval_pending';
}

export async function getPendingToolApproval(conversationId: string, userId: string, messageId: string): Promise<PendingToolApproval> {
  await assertConversationOwner(conversationId, userId);
  const row = await prisma.message.findFirst({
    where: { id: messageId, conversationId, role: 'tool' },
    select: { id: true, toolName: true, toolArgs: true, toolResult: true },
  });
  if (!row || !row.toolName || !isPending(row.toolResult)) {
    throw new HTTPException(409, { message: 'La aprobación ya no está pendiente.' });
  }
  return { id: row.id, toolName: row.toolName, toolArgs: row.toolArgs };
}

export async function claimPendingToolApproval(conversationId: string, messageId: string): Promise<boolean> {
  const result = await prisma.message.updateMany({
    where: { id: messageId, conversationId, role: 'tool', toolResult: { equals: { state: 'approval_pending' } } },
    data: { toolResult: { state: 'approval_executing' } as Prisma.InputJsonValue },
  });
  return result.count === 1;
}

export async function cancelPendingToolApproval(conversationId: string, messageId: string): Promise<boolean> {
  const result = await prisma.message.updateMany({
    where: { id: messageId, conversationId, role: 'tool', toolResult: { equals: { state: 'approval_pending' } } },
    data: { toolResult: 'El usuario canceló la acción.', content: 'El usuario canceló la acción.' },
  });
  return result.count === 1;
}

export async function finishPendingToolApproval(
  conversationId: string,
  messageId: string,
  _state: 'completed' | 'failed',
  resultValue: unknown,
): Promise<void> {
  let result: Prisma.InputJsonValue | null;
  try {
    const serialized = JSON.stringify(resultValue);
    result = serialized === undefined ? null : JSON.parse(serialized) as Prisma.InputJsonValue;
  } catch {
    result = String(resultValue);
  }
  const updated = await prisma.message.updateMany({
    where: { id: messageId, conversationId, role: 'tool', toolResult: { equals: { state: 'approval_executing' } } },
    data: {
      toolResult: result as Prisma.InputJsonValue,
      content: shrinkToolContent('tool approval', resultValue, true),
    },
  });
  if (updated.count !== 1) throw new Error('Tool approval state changed while executing');
}
