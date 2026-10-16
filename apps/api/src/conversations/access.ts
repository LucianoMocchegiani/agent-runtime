import { prisma } from '../db/prisma.js';
import { ConversationNotFoundError } from './errors.js';

/** Verifica que la conversación exista y pertenezca al usuario indicado. */
export async function assertConversationOwner(
  conversationId: string,
  userId: string,
): Promise<void> {
  const row = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!row) {
    throw new ConversationNotFoundError();
  }
}
