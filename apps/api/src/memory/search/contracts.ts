/** Contratos de búsqueda de recuerdos. */

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
