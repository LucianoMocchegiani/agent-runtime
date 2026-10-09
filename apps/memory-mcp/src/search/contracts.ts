export type SearchDocument = {
  messageId: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
};

export type SearchFilter = {
  userId: string;
  conversationId?: string;
};

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

export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Backend neutral index contract; the first adapter is PostgreSQL + pgvector. */
export interface SearchIndex {
  upsertDocument(document: SearchDocument): Promise<void>;
  claimPending(batchSize: number): Promise<SearchDocument[]>;
  saveEmbedding(messageId: string, model: string, vector: number[]): Promise<void>;
  retryEmbedding(messageId: string, delayMs: number): Promise<void>;
  requeueAllEmbeddings(): Promise<void>;
  searchText(query: string, filter: SearchFilter, limit: number): Promise<SearchHit[]>;
  searchVector(vector: number[], filter: SearchFilter, limit: number, model: string): Promise<SearchHit[]>;
}
