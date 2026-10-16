/**
 * Tipos y DTOs del módulo interno Memory: conversaciones, mensajes, recuerdos y preferencias.
 * Runtime consume estas operaciones como llamadas de código dentro del mismo proceso; no son transporte MCP.
 */

/** Valor compatible con JSON, usado en argumentos y resultados de herramientas. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Mensaje serializable de una conversación, incluidos los metadatos opcionales de tools. */
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

/** Conversación serializada para consumidores del módulo Memory. */
export type ConversationDto = {
  id: string;
  userId: string;
  title: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  agentProfileId: string | null;
};

/** Identidad y conversación requeridas para cargar contexto. */
export type GetContextParams = {
  conversationId: string;
  userId: string;
};

/** Historial reciente y metadatos de avance del resumen persistente. */
export type GetContextResult = {
  messages: MessageDto[];
  summary: string | null;
  summaryRevision: number;
  summaryThroughMessageId: string | null;
  summaryThroughCreatedAt: string | null;
  /** True si existen mensajes anteriores a la página devuelta. */
  hasMore: boolean;
};

/** Resumen incremental junto con el cursor y revisión esperados. */
export type SaveSummaryParams = {
  conversationId: string;
  userId: string;
  summary: string;
  throughMessageId: string;
  throughCreatedAt: string;
  expectedRevision: number;
};

/** Datos necesarios para persistir un mensaje de usuario, asistente o herramienta. */
export type SaveMessageParams = {
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string | null;
  toolArgs?: JsonValue | null;
  toolResult?: JsonValue | null;
};

/** Solicitud de edición optimista; confirma cuántos mensajes posteriores se eliminarán. */
export type EditMessageParams = {
  conversationId: string;
  messageId: string;
  userId: string;
  content: string;
  /** Número de mensajes posteriores confirmado por el usuario en la UI. */
  expectedLaterMessages: number;
};

/** Resultado de editar un mensaje e invalidar el historial posterior. */
export type EditMessageResult = {
  deletedLaterMessages: number;
};

/** Error cuando el mensaje objetivo no existe, no es propio o no es editable. */
export class MessageNotEditableError extends Error {
  constructor(message = 'Message cannot be edited') {
    super(message);
    this.name = 'MessageNotEditableError';
  }
}

/** Error de concurrencia cuando cambió la cantidad de mensajes posteriores confirmada. */
export class MessageEditConflictError extends Error {
  constructor() {
    super('Conversation changed since the edit was confirmed');
    this.name = 'MessageEditConflictError';
  }
}

/** Error cuando un mensaje con adjuntos no persistidos no puede regenerarse con seguridad. */
export class MessageContainsUnstoredAttachmentError extends Error {
  constructor() {
    super('Messages with unstored attachments cannot be edited');
    this.name = 'MessageContainsUnstoredAttachmentError';
  }
}

/** Parámetros de creación de una conversación y perfil inicial. */
export type CreateConversationParams = {
  userId: string;
  title?: string | null;
  agentProfileId?: string | null;
};

/** Campos modificables de una conversación; los ausentes no se actualizan. */
export type UpdateConversationPatch = {
  title?: string | null;
  archived?: boolean;
  agentProfileId?: string | null;
};

/** Cursor estable para paginar conversaciones por actividad e identificador. */
export type ConversationCursor = {
  updatedAt: string;
  id: string;
};

/** Filtros de listado paginado de conversaciones por usuario. */
export type ListConversationsParams = {
  userId: string;
  /** Omit to include both active and archived conversations. */
  archived?: boolean;
  limit?: number;
  before?: ConversationCursor;
};

/** Cursor estable para paginar mensajes por fecha de creación e identificador. */
export type MessageCursor = {
  createdAt: string;
  id: string;
};

/** Filtros de listado paginado de mensajes en una conversación. */
export type ListMessagesParams = {
  conversationId: string;
  userId: string;
  limit?: number;
  before?: MessageCursor;
};

/** Página de mensajes y cursor para solicitar la página anterior. */
export type ListMessagesResult = {
  items: MessageDto[];
  hasMore: boolean;
  nextCursor: MessageCursor | null;
};

/** Identificador y propietario requeridos para consultar una conversación. */
export type GetConversationParams = {
  id: string;
  userId: string;
};

/** Conversación, propietario y cambios que se aplicarán. */
export type UpdateConversationParams = {
  id: string;
  userId: string;
  patch: UpdateConversationPatch;
};

/** Identidad y conversación que se archivará. */
export type ArchiveConversationParams = {
  id: string;
  userId: string;
};

/** Datos del primer mensaje usados para intentar asignar el título automático. */
export type ApplyTitleParams = {
  conversationId: string;
  userId: string;
  userText: string;
};

/** Consulta semántica/textual limitada al usuario y opcionalmente a un hilo. */
export type MemorySearchParams = {
  userId: string;
  query: string;
  conversationId?: string;
  limit?: number;
};

/** Mensaje coincidente con metadatos de conversación y puntuación de relevancia. */
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

/** Resultado de búsqueda e indicación de si se usó modo textual o híbrido. */
export type MemorySearchResult = {
  mode: 'text' | 'hybrid';
  items: MemorySearchHit[];
};

/** Preferencia persistente serializada para el cliente o el agente. */
export type UserPreferenceDto = {
  id: string;
  preference: string;
  activationCondition: string;
  category: string | null;
  createdAt: string;
  score?: number;
};

/** Preferencia y condición de activación que se guardarán para un usuario. */
export type SavePreferenceParams = {
  userId: string;
  preference: string;
  activationCondition: string;
  category?: string | null;
};

/** Consulta de recuperación de preferencias aplicables a un usuario. */
export type SearchPreferencesParams = {
  userId: string;
  query: string;
  limit?: number;
};

/** Cursor estable para paginar preferencias por creación e identificador. */
export type PreferenceCursor = {
  createdAt: string;
  id: string;
};

/** Usuario y cursor/límite para listar preferencias guardadas. */
export type ListPreferencesParams = {
  userId: string;
  limit?: number;
  before?: PreferenceCursor;
};

/** Identificadores del usuario y preferencia que se eliminará. */
export type DeletePreferenceParams = {
  userId: string;
  id: string;
};

/**
 * Convierte un valor a la forma JSON del contrato, omitiendo `undefined`.
 * @param value Valor de origen, potencialmente no serializable.
 * @returns Valor JSON compatible o representación textual si la serialización falla.
 */
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

/** Contrato de operaciones internas implementadas por el módulo Memory. */
export interface MemoryService {
  /** Carga historial reciente y estado del resumen de una conversación propia. */
  getContext(params: GetContextParams): Promise<GetContextResult>;
  /** Guarda un resumen si la revisión esperada sigue vigente. */
  saveSummary(params: SaveSummaryParams): Promise<boolean>;
  /** Persiste un mensaje asociado a una conversación propia. */
  saveMessage(params: SaveMessageParams): Promise<void>;
  /** Edita un mensaje y elimina transaccionalmente los mensajes posteriores. */
  editMessageAndTruncate(params: EditMessageParams): Promise<EditMessageResult>;
  /** Obtiene una página cronológica de mensajes. */
  listMessages(params: ListMessagesParams): Promise<ListMessagesResult>;
  /** Lista conversaciones propias con filtro opcional de archivo. */
  listConversations(params: ListConversationsParams): Promise<ConversationDto[]>;
  /** Crea una conversación para el usuario indicado. */
  createConversation(
    params: CreateConversationParams,
  ): Promise<ConversationDto>;
  /** Obtiene una conversación propia o falla si no existe/no pertenece al usuario. */
  getConversation(params: GetConversationParams): Promise<ConversationDto>;
  /** Aplica cambios a una conversación propia. */
  updateConversation(
    params: UpdateConversationParams,
  ): Promise<ConversationDto>;
  /** Archiva una conversación propia sin eliminarla. */
  archiveConversation(
    params: ArchiveConversationParams,
  ): Promise<ConversationDto>;
  /** Aplica el título inicial si la conversación todavía no tiene uno. */
  applyAutomaticTitle(
    params: ApplyTitleParams,
  ): Promise<string | null>;
  /** Busca mensajes pertinentes, en modo textual o híbrido. */
  searchMemory(params: MemorySearchParams): Promise<MemorySearchResult>;
  /** Guarda una preferencia persistente para el usuario. */
  savePreference(params: SavePreferenceParams): Promise<UserPreferenceDto>;
  /** Lista las preferencias persistentes del usuario. */
  listPreferences(params: ListPreferencesParams): Promise<UserPreferenceDto[]>;
  /** Recupera preferencias relacionadas con una consulta contextual. */
  searchPreferences(params: SearchPreferencesParams): Promise<UserPreferenceDto[]>;
  /** Elimina una preferencia propia; informa si encontró y borró el registro. */
  deletePreference(params: DeletePreferenceParams): Promise<boolean>;
}
