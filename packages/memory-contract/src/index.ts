/**
 * Tipos y DTOs del módulo interno Memory: conversaciones, mensajes, recuerdos y preferencias.
 * Runtime consume estas operaciones como llamadas de código dentro del mismo proceso; no son transporte MCP.
 */

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
  agentProfileId: string | null;
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

export type EditMessageParams = {
  conversationId: string;
  messageId: string;
  userId: string;
  content: string;
  /** Número de mensajes posteriores confirmado por el usuario en la UI. */
  expectedLaterMessages: number;
};

export type EditMessageResult = {
  deletedLaterMessages: number;
};

export class MessageNotEditableError extends Error {
  constructor(message = 'Message cannot be edited') {
    super(message);
    this.name = 'MessageNotEditableError';
  }
}

export class MessageEditConflictError extends Error {
  constructor() {
    super('Conversation changed since the edit was confirmed');
    this.name = 'MessageEditConflictError';
  }
}

export class MessageContainsUnstoredAttachmentError extends Error {
  constructor() {
    super('Messages with unstored attachments cannot be edited');
    this.name = 'MessageContainsUnstoredAttachmentError';
  }
}

export type CreateConversationParams = {
  userId: string;
  title?: string | null;
  agentProfileId?: string | null;
};

export type UpdateConversationPatch = {
  title?: string | null;
  archived?: boolean;
  agentProfileId?: string | null;
};

export type ConversationCursor = {
  updatedAt: string;
  id: string;
};

export type ListConversationsParams = {
  userId: string;
  /** Omit to include both active and archived conversations. */
  archived?: boolean;
  limit?: number;
  before?: ConversationCursor;
};

export type MessageCursor = {
  createdAt: string;
  id: string;
};

export type ListMessagesParams = {
  conversationId: string;
  userId: string;
  limit?: number;
  before?: MessageCursor;
};

export type ListMessagesResult = {
  items: MessageDto[];
  hasMore: boolean;
  nextCursor: MessageCursor | null;
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

export type UserPreferenceDto = {
  id: string;
  preference: string;
  activationCondition: string;
  category: string | null;
  createdAt: string;
  score?: number;
};

export type SavePreferenceParams = {
  userId: string;
  preference: string;
  activationCondition: string;
  category?: string | null;
};

export type SearchPreferencesParams = {
  userId: string;
  query: string;
  limit?: number;
};

export type PreferenceCursor = {
  createdAt: string;
  id: string;
};

export type ListPreferencesParams = {
  userId: string;
  limit?: number;
  before?: PreferenceCursor;
};

export type DeletePreferenceParams = {
  userId: string;
  id: string;
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

export interface MemoryService {
  getContext(params: GetContextParams): Promise<GetContextResult>;
  saveSummary(params: SaveSummaryParams): Promise<boolean>;
  saveMessage(params: SaveMessageParams): Promise<void>;
  editMessageAndTruncate(params: EditMessageParams): Promise<EditMessageResult>;
  listMessages(params: ListMessagesParams): Promise<ListMessagesResult>;
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
  savePreference(params: SavePreferenceParams): Promise<UserPreferenceDto>;
  listPreferences(params: ListPreferencesParams): Promise<UserPreferenceDto[]>;
  searchPreferences(params: SearchPreferencesParams): Promise<UserPreferenceDto[]>;
  deletePreference(params: DeletePreferenceParams): Promise<boolean>;
}
