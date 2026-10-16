/** DTOs y parámetros propios del dominio de conversaciones. */

/** Conversación serializada para consumidores de la API. */
export type ConversationDto = {
  id: string;
  userId: string;
  title: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  agentProfileId: string | null;
};

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
