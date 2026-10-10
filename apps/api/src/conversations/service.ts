import { HTTPException } from 'hono/http-exception';
import { createMemoryClient } from '../memory/client.js';
import type { Principal } from '../auth/principal.js';
import type {
  ConversationDto,
  UpdateConversationPatch,
} from 'agent-runtime-memory-contract';

const LIST_TAKE = 100;
const TITLE_MAX = 200;

/**
 * Lista hilos del principal, más recientes primero.
 *
 * @param archived Si true, solo archivados; si false, solo activos.
 */
export async function listConversations(
  principal: Principal,
  archived: boolean,
): Promise<ConversationDto[]> {
  const memory = await createMemoryClient();
  try {
    const items = await memory.listConversations({
      userId: principal.userId,
      archived,
    });
    return items.slice(0, LIST_TAKE);
  } finally {
  }
}

/**
 * Alta de hilo vacío. `userId` sale del principal.
 */
export async function createConversation(
  principal: Principal,
  title: string | null,
  agentProfileId: string,
): Promise<ConversationDto> {
  const memory = await createMemoryClient();
  try {
    return await memory.createConversation({
      userId: principal.userId,
      title,
      agentProfileId,
    });
  } finally {
  }
}

export async function getConversation(
  principal: Principal,
  id: string,
): Promise<ConversationDto> {
  const memory = await createMemoryClient();
  try {
    return await memory.getConversation({
      id,
      userId: principal.userId,
    });
  } finally {
  }
}

export async function updateConversation(
  principal: Principal,
  id: string,
  patch: UpdateConversationPatch,
): Promise<ConversationDto> {
  const memory = await createMemoryClient();
  try {
    return await memory.updateConversation({
      id,
      userId: principal.userId,
      patch,
    });
  } finally {
  }
}

/**
 * Pone título al primer mensaje si el hilo todavía no tiene uno.
 *
 * @returns El título aplicado, o null si ya había título.
 */
export async function applyAutomaticTitle(
  principal: Principal,
  conversationId: string,
  userText: string,
): Promise<string | null> {
  const memory = await createMemoryClient();
  try {
    return await memory.applyAutomaticTitle({
      conversationId,
      userId: principal.userId,
      userText,
    });
  } finally {
  }
}

/**
 * Archivo lógico (`archived_at`). Idempotente.
 */
export async function archiveConversation(
  principal: Principal,
  id: string,
): Promise<ConversationDto> {
  return updateConversation(principal, id, { archived: true });
}

export function parseTitleInput(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HTTPException(400, { message: 'title must be a string' });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > TITLE_MAX) {
    throw new HTTPException(400, { message: `title max ${TITLE_MAX} chars` });
  }
  return trimmed;
}