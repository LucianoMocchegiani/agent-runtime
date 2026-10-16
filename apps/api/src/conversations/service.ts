import { HTTPException } from 'hono/http-exception';
import { createMemoryClient } from '../memory/client.js';
import type { Principal } from '../auth/principal.js';
import type {
  ConversationDto,
  UpdateConversationPatch,
} from 'agent-runtime-memory-contract';

const TITLE_MAX = 200;

/**
 * Lista las conversaciones del principal, ordenadas por actividad reciente.
 * @param principal Identidad propietaria de los datos.
 * @param archived Si es `true`, incluye archivadas; si es `false`, solo activas.
 * @param options Límite y cursor de continuación.
 */
export async function listConversations(
  principal: Principal,
  archived: boolean,
  options: { limit: number; before?: { updatedAt: string; id: string } },
): Promise<ConversationDto[]> {
  const memory = createMemoryClient();
  return memory.listConversations({
    userId: principal.userId,
    archived,
    limit: options.limit,
    ...(options.before ? { before: options.before } : {}),
  });
}

/**
 * Crea un hilo vacío asociado al principal autenticado.
 * @param principal Identidad propietaria del hilo.
 * @param title Título inicial o `null` para asignarlo automáticamente.
 * @param agentProfileId Perfil fijado al nuevo hilo.
 */
export async function createConversation(
  principal: Principal,
  title: string | null,
  agentProfileId: string,
): Promise<ConversationDto> {
  const memory = createMemoryClient();
  return memory.createConversation({
    userId: principal.userId,
    title,
    agentProfileId,
  });
}

/** Obtiene una conversación del principal; nunca permite consultar hilos ajenos. */
export async function getConversation(
  principal: Principal,
  id: string,
): Promise<ConversationDto> {
  const memory = createMemoryClient();
  return memory.getConversation({
    id,
    userId: principal.userId,
  });
}

/** Aplica un parche a una conversación propiedad del principal. */
export async function updateConversation(
  principal: Principal,
  id: string,
  patch: UpdateConversationPatch,
): Promise<ConversationDto> {
  const memory = createMemoryClient();
  return memory.updateConversation({
    id,
    userId: principal.userId,
    patch,
  });
}

/**
 * Asigna un título automático al primer mensaje solo si el hilo aún no tiene título.
 * @returns El título aplicado o `null` si ya existía uno.
 */
export async function applyAutomaticTitle(
  principal: Principal,
  conversationId: string,
  userText: string,
): Promise<string | null> {
  const memory = createMemoryClient();
  return memory.applyAutomaticTitle({
    conversationId,
    userId: principal.userId,
    userText,
  });
}

/**
 * Archiva lógicamente la conversación. La operación es idempotente.
 */
export async function archiveConversation(
  principal: Principal,
  id: string,
): Promise<ConversationDto> {
  return updateConversation(principal, id, { archived: true });
}

/** Valida y normaliza `title`, preservando la diferencia entre ausente y `null`.
 * @throws {HTTPException} 400 si no es texto o excede el máximo permitido.
 */
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