import { prisma } from '../db/prisma.js';
import type {
  ConversationDto,
  ListConversationsParams,
  GetConversationParams,
  CreateConversationParams,
  UpdateConversationParams,
  ArchiveConversationParams,
  ApplyTitleParams,
} from './contracts.js';
import { ConversationNotFoundError } from './errors.js';
import { assertConversationOwner } from './access.js';
import { titleFromFirstMessage } from './title.js';

function toConversationDto(row: {
  id: string;
  userId: string;
  title: string | null;
  agentProfileId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ConversationDto {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    agentProfileId: row.agentProfileId,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const LIST_TAKE = 100;

/** Lista conversaciones del usuario con filtro opcional de archivo y cursor estable. */
export async function listConversations(
  params: ListConversationsParams,
): Promise<ConversationDto[]> {
  const requestedLimit = params.limit ?? LIST_TAKE;
  const limit = Math.max(1, Math.min(requestedLimit, LIST_TAKE));
  const beforeUpdatedAt = params.before ? new Date(params.before.updatedAt) : null;
  if (params.before && (!beforeUpdatedAt || !Number.isFinite(beforeUpdatedAt.getTime()))) {
    throw new Error('Invalid conversation cursor');
  }
  const rows = await prisma.conversation.findMany({
    where: {
      userId: params.userId,
      ...(params.archived === undefined ? {} : {
        archivedAt: params.archived ? { not: null } : null,
      }),
      ...(params.before && beforeUpdatedAt ? {
        OR: [
          { updatedAt: { lt: beforeUpdatedAt } },
          { updatedAt: beforeUpdatedAt, id: { lt: params.before.id } },
        ],
      } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return rows.map(toConversationDto);
}

/** Crea una conversación para el usuario y fija el perfil que usará el hilo. */
export async function createConversation(
  params: CreateConversationParams,
): Promise<ConversationDto> {
  const row = await prisma.conversation.create({
    data: {
      userId: params.userId,
      tenantId: 'public',
      title: params.title ?? null,
      agentProfileId: params.agentProfileId ?? null,
    },
  });
  return toConversationDto(row);
}

/** Obtiene una conversación después de validar que pertenece al usuario indicado. */
export async function getConversation(
  params: GetConversationParams,
): Promise<ConversationDto> {
  const { id, userId } = params;
  await assertConversationOwner(id, userId);
  const row = await prisma.conversation.findUnique({ where: { id } });
  if (!row) {
    throw new ConversationNotFoundError();
  }
  return toConversationDto(row);
}

/** Actualiza título, estado de archivo y/o perfil de una conversación propia. */
export async function updateConversation(
  params: UpdateConversationParams,
): Promise<ConversationDto> {
  const { id, userId, patch } = params;
  await assertConversationOwner(id, userId);
  const row = await prisma.conversation.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.agentProfileId !== undefined ? { agentProfileId: patch.agentProfileId } : {}),
      ...(patch.archived !== undefined
        ? { archivedAt: patch.archived ? new Date() : null }
        : {}),
    },
  });
  return toConversationDto(row);
}

/** Archiva una conversación propia sin eliminar sus mensajes. */
export async function archiveConversation(
  params: ArchiveConversationParams,
): Promise<ConversationDto> {
  const { id, userId } = params;
  await assertConversationOwner(id, userId);
  const row = await prisma.conversation.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return toConversationDto(row);
}

/** Asigna el título derivado del primer mensaje solo si todavía no hay título. */
export async function applyAutomaticTitle(
  params: ApplyTitleParams,
): Promise<string | null> {
  const { conversationId, userId, userText } = params;
  await assertConversationOwner(conversationId, userId);
  const title = titleFromFirstMessage(userText);
  const result = await prisma.conversation.updateMany({
    where: { id: conversationId, title: null },
    data: { title },
  });
  return result.count > 0 ? title : null;
}
