import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import {
  type GetContextParams,
  type GetContextResult,
  type SaveSummaryParams,
  type SaveMessageParams,
  type EditMessageParams,
  type EditMessageResult,
  type ListMessagesParams,
  type ListMessagesResult,
  type JsonValue,
  type MessageDto,
} from './contracts.js';
import {
  ConversationNotFoundError,
  MessageContainsUnstoredAttachmentError,
  MessageEditConflictError,
  MessageNotEditableError,
} from './errors.js';
import { assertConversationOwner } from './conversation-access.js';

function toJsonPrisma(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

function toMessageDto(row: {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  toolName: string | null;
  toolArgs: unknown;
  toolResult: unknown;
  createdAt: Date;
}): MessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as MessageDto['role'],
    content: row.content,
    toolName: row.toolName,
    toolArgs: toJsonPrisma(row.toolArgs) as JsonValue,
    toolResult: toJsonPrisma(row.toolResult) as JsonValue,
    createdAt: row.createdAt.toISOString(),
  };
}

const CONTEXT_MESSAGES_TAKE = 500;
const DEFAULT_MESSAGES_TAKE = 50;
const MAX_MESSAGES_TAKE = 100;

/**
 * Carga el historial reciente y el estado del resumen tras verificar la propiedad del hilo.
 * @param params Identidad y conversación cuyo contexto se necesita.
 * @returns Mensajes en orden cronológico, resumen y cursor de resumen.
 */
export async function getContext(
  params: GetContextParams,
): Promise<GetContextResult> {
  const { conversationId, userId } = params;
  await assertConversationOwner(conversationId, userId);
  const [conversation, descendingRows] = await Promise.all([
    prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: {
        summary: true,
        summaryRevision: true,
        summaryThroughMessageId: true,
        summaryThroughCreatedAt: true,
      },
    }),
    prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: CONTEXT_MESSAGES_TAKE + 1,
    }),
  ]);
  if (!conversation) throw new ConversationNotFoundError();
  const hasMore = descendingRows.length > CONTEXT_MESSAGES_TAKE;
  const rows = descendingRows.slice(0, CONTEXT_MESSAGES_TAKE).reverse();

  return {
    messages: rows.map(toMessageDto),
    hasMore,
    summary: conversation.summary,
    summaryRevision: conversation.summaryRevision,
    summaryThroughMessageId: conversation.summaryThroughMessageId,
    summaryThroughCreatedAt: conversation.summaryThroughCreatedAt?.toISOString() ?? null,
  };
}

/** Guarda un resumen solo si coincide la revisión esperada, evitando sobrescribir otro turno. */
export async function saveSummary(params: SaveSummaryParams): Promise<boolean> {
  const throughCreatedAt = new Date(params.throughCreatedAt);
  if (!Number.isFinite(throughCreatedAt.getTime()) || !params.summary.trim()) return false;
  const result = await prisma.conversation.updateMany({
    where: {
      id: params.conversationId,
      userId: params.userId,
      summaryRevision: params.expectedRevision,
    },
    data: {
      summary: params.summary.trim(),
      summaryRevision: { increment: 1 },
      summaryThroughMessageId: params.throughMessageId,
      summaryThroughCreatedAt: throughCreatedAt,
    },
  });
  return result.count === 1;
}

/** Persiste un mensaje de usuario, asistente o herramienta en una conversación propia. */
export async function saveMessage(
  params: SaveMessageParams,
): Promise<void> {
  const { conversationId, userId } = params;
  await assertConversationOwner(conversationId, userId);
  await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      toolName: params.toolName,
      toolArgs: toJsonPrisma(params.toolArgs) as Prisma.InputJsonValue,
      toolResult: toJsonPrisma(params.toolResult) as Prisma.InputJsonValue,
    },
  });
}

/**
 * Edita un mensaje propio y elimina transaccionalmente los mensajes posteriores, invalidando el resumen.
 * @throws {MessageEditConflictError} Si cambió el historial posterior desde la confirmación.
 * @throws {MessageNotEditableError} Si el objetivo no es un mensaje propio editable.
 * @throws {MessageContainsUnstoredAttachmentError} Si el mensaje contiene adjuntos que no se guardaron.
 */
export async function editMessageAndTruncate(
  params: EditMessageParams,
): Promise<EditMessageResult> {
  const { conversationId, messageId, userId, content, expectedLaterMessages } = params;
  if (!Number.isInteger(expectedLaterMessages) || expectedLaterMessages < 0) {
    throw new MessageEditConflictError();
  }

  return prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });
    if (!conversation) throw new ConversationNotFoundError();

    const message = await tx.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    if (!message || message.role !== 'user') throw new MessageNotEditableError();
    if (message.content.includes('[Imagen adjunta; no almacenada]')
      || message.content.includes('imágenes adjuntas; no almacenadas]')) {
      throw new MessageContainsUnstoredAttachmentError();
    }

    const laterWhere = {
      conversationId,
      OR: [
        { createdAt: { gt: message.createdAt } },
        { createdAt: message.createdAt, id: { gt: message.id } },
      ],
    };
    const laterCount = await tx.message.count({ where: laterWhere });
    if (laterCount !== expectedLaterMessages) throw new MessageEditConflictError();

    await tx.message.deleteMany({
      where: {
        conversationId,
        OR: [
          { createdAt: { gt: message.createdAt } },
          { createdAt: message.createdAt, id: { gte: message.id } },
        ],
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        summary: null,
        summaryRevision: { increment: 1 },
        summaryThroughMessageId: null,
        summaryThroughCreatedAt: null,
      },
    });
    await tx.message.create({
      data: { conversationId, role: 'user', content },
    });
    return { deletedLaterMessages: laterCount };
  });
}

/** Lista una página de mensajes de una conversación propia, en orden cronológico. */
export async function listMessages(
  params: ListMessagesParams,
): Promise<ListMessagesResult> {
  const { conversationId, userId } = params;
  await assertConversationOwner(conversationId, userId);

  const requestedLimit = Math.floor(params.limit ?? DEFAULT_MESSAGES_TAKE);
  const limit = Math.max(1, Math.min(requestedLimit, MAX_MESSAGES_TAKE));
  const beforeCreatedAt = params.before ? new Date(params.before.createdAt) : null;
  if (params.before && (!beforeCreatedAt || !Number.isFinite(beforeCreatedAt.getTime()))) {
    throw new Error('Invalid message cursor');
  }

  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      ...(params.before && beforeCreatedAt ? {
        OR: [
          { createdAt: { lt: beforeCreatedAt } },
          { createdAt: beforeCreatedAt, id: { lt: params.before.id } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const oldest = page[0];
  return {
    items: page.map(toMessageDto),
    hasMore,
    nextCursor: hasMore && oldest
      ? { createdAt: oldest.createdAt.toISOString(), id: oldest.id }
      : null,
  };
}
