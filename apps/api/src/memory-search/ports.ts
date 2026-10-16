/** Mensaje indexable para búsqueda de memoria. */
export type SearchDocument = {
  messageId: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
};

/** Restricciones de usuario y conversación aplicables a una búsqueda. */
export type SearchFilter = {
  userId: string;
  conversationId?: string;
};

/** Documento coincidente, metadatos y puntuación de relevancia. */
export type SearchHit = {
  messageId: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  title: string | null;
  score: number;
};

/** Adaptador de un proveedor que genera vectores de embedding. */
export interface EmbeddingProvider {
  /** Identificador del modelo que produce los vectores. */
  readonly model: string;
  /** Devuelve un vector de embedding para cada entrada, en el mismo orden. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Contrato neutral del índice; el primer adaptador usa PostgreSQL y pgvector. */
export interface SearchIndex {
  /** Inserta o reemplaza un documento y lo deja pendiente de indexación. */
  upsertDocument(document: SearchDocument): Promise<void>;
  /** Reclama documentos pendientes para que un worker genere embeddings. */
  claimPending(batchSize: number): Promise<SearchDocument[]>;
  /** Persiste el vector y marca como listo el documento correspondiente. */
  saveEmbedding(messageId: string, model: string, vector: number[]): Promise<void>;
  /** Devuelve un documento a la cola con el retraso especificado. */
  retryEmbedding(messageId: string, delayMs: number): Promise<void>;
  /** Invalida los vectores para que se recalculen con la configuración actual. */
  requeueAllEmbeddings(): Promise<void>;
  /** Ejecuta búsqueda textual filtrada por usuario y, opcionalmente, conversación. */
  searchText(query: string, filter: SearchFilter, limit: number): Promise<SearchHit[]>;
  /** Ejecuta búsqueda por similitud vectorial para el modelo indicado. */
  searchVector(vector: number[], filter: SearchFilter, limit: number, model: string): Promise<SearchHit[]>;
}
