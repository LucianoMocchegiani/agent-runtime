import { prisma } from './prisma.js';
import {
  type MessageDto,
  type ConversationDto,
  type GetContextParams,
  type GetContextResult,
  type SaveMessageParams,
  type CreateConversationParams,
  type UpdateConversationPatch,
  type ListConversationsParams,
  type ListMessagesParams,
  type GetConversationParams,
  type UpdateConversationParams,
  type ArchiveConversationParams,
  type ApplyTitleParams,
  type JsonValue,
} from 'agent-runtime-memory-contract';
import { Prisma } from '@prisma/client';
import { titleFromFirstMessage } from './title.js';

/** El MCP lo devuelve como tool error con este mensaje. */
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
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ConversationDto {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
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
const MESSAGES_TAKE = 500;

export async function getContext(
  params: GetContextParams,
): Promise<GetContextResult> {
  const { conversationId, userId, tokenBudget } = params;
  await assertConversationOwner(conversationId, userId);
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: MESSAGES_TAKE,
  });

  const budget = tokenBudget ?? 10_000;
  let used = 0;
  const kept: MessageDto[] = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    const text = row.content ?? '';
    const cost = Math.max(1, Math.ceil(text.length / 4));
    if (kept.length > 0 && used + cost > budget) {
      continue;
    }
    kept.unshift(toMessageDto(row));
    used += cost;
  }

  return { messages: kept, summary: null, checkpoint: null };
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
): Promise<MessageDto[]> {
  const { conversationId, userId } = params;
  await assertConversationOwner(conversationId, userId);
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: MESSAGES_TAKE,
  });
  return rows.map(toMessageDto);
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