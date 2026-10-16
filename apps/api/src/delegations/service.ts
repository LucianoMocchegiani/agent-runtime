import { randomUUID } from 'node:crypto';
import type { Principal } from '../auth/contracts.js';
import type { DelegationEvent, DelegationPayload } from './contracts.js';
import {
  getDelegationForUser as readDelegationForUser,
  insertQueuedDelegation,
  listDelegationEvents as readDelegationEvents,
  listDelegationsForUser as readDelegationsForUser,
} from './persistence.js';
import { sealDelegationPayload } from './payload.js';

/** Encripta los datos sensibles y crea una delegación con su evento inicial. */
export async function enqueueDelegation(input: {
  principal: Principal;
  sourceConversationId: string;
  targetConversationId: string;
  instruction: string;
  accessToken: string;
  mcpTokens: Record<string, string> | null;
}): Promise<{ id: string; status: 'queued' }> {
  const id = randomUUID();
  const payload: DelegationPayload = {
    principal: input.principal,
    accessToken: input.accessToken,
    mcpTokens: input.mcpTokens,
    instruction: input.instruction,
  };
  const sealed = sealDelegationPayload(payload);
  await insertQueuedDelegation({
    id,
    userId: input.principal.userId,
    sourceConversationId: input.sourceConversationId,
    targetConversationId: input.targetConversationId,
    ciphertext: sealed.ciphertext,
    nonce: sealed.nonce,
    tag: sealed.tag,
  });
  return { id, status: 'queued' };
}

/** Lista delegaciones del usuario autenticado sin datos operativos sensibles. */
export async function listUserDelegations(userId: string) {
  return readDelegationsForUser(userId);
}

/** Busca una delegación únicamente dentro del ámbito del usuario indicado. */
export async function findUserDelegation(jobId: string, userId: string) {
  return readDelegationForUser(jobId, userId);
}

/** Lee el estado visible y sus eventos en una operación de uso autorizada para SSE. */
export async function readUserDelegationEvents(
  jobId: string,
  userId: string,
  afterId: string,
): Promise<{ delegation: NonNullable<Awaited<ReturnType<typeof readDelegationForUser>>>; events: DelegationEvent[] } | null> {
  const delegation = await readDelegationForUser(jobId, userId);
  if (!delegation) return null;
  const events = await readDelegationEvents(jobId, afterId);
  return { delegation, events };
}
