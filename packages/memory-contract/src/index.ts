/**
 * Contrato del Memory MCP: nombres de tools y formas de entrada/salida.
 *
 * @remarks Lo implementa `apps/memory-mcp` (default) y lo consume `apps/api`. Cualquier
 * implementación alternativa (Engram, Mem0, propia) debe exponer estas tools por MCP.
 */

export const MEMORY_TOOLS = {
  getContext: 'getContext',
  saveSummary: 'saveSummary',
  saveMessage: 'saveMessage',
  listMessages: 'listMessages',
  listConversations: 'listConversations',
  createConversation: 'createConversation',
  getConversation: 'getConversation',
  updateConversation: 'updateConversation',
  archiveConversation: 'archiveConversation',
  applyAutomaticTitle: 'applyAutomaticTitle',
  searchMemory: 'searchMemory',
} as const;

export type MemoryToolName = (typeof MEMORY_TOOLS)[keyof typeof MEMORY_TOOLS];

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type MessageDto = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName: string | null;
  toolArgs: JsonValue | null;
  toolResult: JsonValue | null;
  createdAt: string;
};

export type ConversationDto = {
  id: string;
  userId: string;
  title: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GetContextParams = {
  conversationId: string;
  userId: string;
  task?: string;
};

export type GetContextResult = {
  messages: MessageDto[];
  summary: string | null;
  summaryRevision: number;
  summaryThroughMessageId: string | null;
  summaryThroughCreatedAt: string | null;
  checkpoint: JsonValue | null;
  /** True si existen mensajes anteriores a la página devuelta. */
  hasMore: boolean;
};

export type SaveSummaryParams = {
  conversationId: string;
  userId: string;
  summary: string;
  throughMessageId: string;
  throughCreatedAt: string;
  expectedRevision: number;
};

export type SaveMessageParams = {
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string | null;
  toolArgs?: JsonValue | null;
  toolResult?: JsonValue | null;
};

export type CreateConversationParams = {
  userId: string;
  title?: string | null;
};

export type UpdateConversationPatch = {
  title?: string | null;
  archived?: boolean;
};

export type ListConversationsParams = {
  userId: string;
  archived?: boolean;
};

export type ListMessagesParams = {
  conversationId: string;
  userId: string;
};

export type GetConversationParams = {
  id: string;
  userId: string;
};

export type UpdateConversationParams = {
  id: string;
  userId: string;
  patch: UpdateConversationPatch;
};

export type ArchiveConversationParams = {
  id: string;
  userId: string;
};

export type ApplyTitleParams = {
  conversationId: string;
  userId: string;
  userText: string;
};

export type MemorySearchParams = {
  userId: string;
  query: string;
  conversationId?: string;
  limit?: number;
};

export type MemorySearchHit = {
  messageId: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  title: string | null;
  score: number;
};

export type MemorySearchResult = {
  mode: 'text' | 'hybrid';
  items: MemorySearchHit[];
};

export function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    JSON.stringify(value);
    return value as JsonValue;
  } catch {
    return JSON.stringify(String(value));
  }
}

export interface MemoryMcp {
  getContext(params: GetContextParams): Promise<GetContextResult>;
  saveSummary(params: SaveSummaryParams): Promise<boolean>;
  saveMessage(params: SaveMessageParams): Promise<void>;
  listMessages(params: ListMessagesParams): Promise<MessageDto[]>;
  listConversations(params: ListConversationsParams): Promise<ConversationDto[]>;
  createConversation(
    params: CreateConversationParams,
  ): Promise<ConversationDto>;
  getConversation(params: GetConversationParams): Promise<ConversationDto>;
  updateConversation(
    params: UpdateConversationParams,
  ): Promise<ConversationDto>;
  archiveConversation(
    params: ArchiveConversationParams,
  ): Promise<ConversationDto>;
  applyAutomaticTitle(
    params: ApplyTitleParams,
  ): Promise<string | null>;
  searchMemory(params: MemorySearchParams): Promise<MemorySearchResult>;
  close(): Promise<void>;
}
