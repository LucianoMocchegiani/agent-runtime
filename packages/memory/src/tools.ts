import { prisma } from './prisma.js';
import {
  type MessageDto,
  type ConversationDto,
  type GetContextParams,
  type GetContextResult,
  type SaveSummaryParams,
  type SaveMessageParams,
  type CreateConversationParams,
  type UpdateConversationPatch,
  type ListConversationsParams,
  type ListMessagesParams,
  type ListMessagesResult,
  type GetConversationParams,
  type UpdateConversationParams,
  type ArchiveConversationParams,
  type ApplyTitleParams,
  type JsonValue,
} from 'agent-runtime-memory-contract';
import { Prisma } from '@prisma/client';
import { titleFromFirstMessage } from './title.js';

/** Error de dominio cuando un hilo no existe o no pertenece al usuario. */
export class ConversationNotFoundError extends Error {
  constructor() {
    super('Conversation not found');
    this.name = 'ConversationNotFoundError';
  }
}

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

async function assertConversationOwner(
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

const LIST_TAKE = 100;
const CONTEXT_MESSAGES_TAKE = 500;
const DEFAULT_MESSAGES_TAKE = 50;
const MAX_MESSAGES_TAKE = 100;

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
    checkpoint: null,
  };
}

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

export async function listConversations(
  params: ListConversationsParams,
): Promise<ConversationDto[]> {
  const rows = await prisma.conversation.findMany({
    where: {
      userId: params.userId,
      archivedAt: params.archived ? { not: null } : null,
    },
    orderBy: { updatedAt: 'desc' },
    take: LIST_TAKE,
  });
  return rows.map(toConversationDto);
}

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