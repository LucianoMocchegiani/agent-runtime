/** DTOs y parámetros propios del dominio de mensajes. */

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
