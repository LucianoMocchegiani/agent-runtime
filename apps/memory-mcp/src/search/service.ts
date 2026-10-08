import type { EmbeddingProvider, SearchHit, SearchIndex } from './contracts.js';
import { OpenAiCompatibleEmbeddingProvider } from './embedding-provider.js';
import { PostgresSearchIndex } from './postgres-index.js';

const BATCH_SIZE = 16;
const POLL_MS = 2_000;
const MAX_RETRY_MS = 5 * 60_000;
const RRF_K = 60;

export type SearchMemoryInput = {
  userId: string;
  query: string;
  conversationId?: string;
  limit?: number;
};

export type SearchMemoryOutput = {
  mode: 'text' | 'hybrid';
  items: SearchHit[];
};

type EmbeddingConfig = {
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
};

function configuredEmbeddingProvider(): EmbeddingProvider | null {
  const rawConfig = process.env.MEMORY_EMBEDDING_CONFIG?.trim();
  let config: EmbeddingConfig = {};

  if (rawConfig) {
    try {
      const parsed: unknown = JSON.parse(rawConfig);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('must be a JSON object');
      }
      config = parsed as EmbeddingConfig;
    } catch (error) {
      throw new Error(`MEMORY_EMBEDDING_CONFIG is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Keep the legacy variables as a fallback for existing deployments.
  const apiKey = typeof config.apiKey === 'string'
    ? config.apiKey.trim()
    : process.env.MEMORY_EMBEDDING_API_KEY?.trim();
  if (!apiKey || apiKey === 'replace-me') return null;

  const baseUrl = typeof config.baseUrl === 'string'
    ? config.baseUrl.trim()
    : process.env.MEMORY_EMBEDDING_BASE_URL?.trim();
  const model = typeof config.model === 'string'
    ? config.model.trim()
    : process.env.MEMORY_EMBEDDING_MODEL?.trim();

  return new OpenAiCompatibleEmbeddingProvider({
    apiKey,
    baseUrl: baseUrl || 'https://api.openai.com/v1',
    model: model || 'text-embedding-3-small',
  });
}

export const searchIndex: SearchIndex = new PostgresSearchIndex();
const embeddingProvider = configuredEmbeddingProvider();

export async function indexMessage(document: Parameters<SearchIndex['upsertDocument']>[0]): Promise<void> {
  await searchIndex.upsertDocument(document);
}

function fuseResults(textHits: SearchHit[], semanticHits: SearchHit[], limit: number): SearchHit[] {
  const combined = new Map<string, { hit: SearchHit; score: number }>();
  for (const [hits, weight] of [[textHits, 1], [semanticHits, 1]] as const) {
    hits.forEach((hit, index) => {
      const current = combined.get(hit.messageId);
      const contribution = weight / (RRF_K + index + 1);
      if (current) current.score += contribution;
      else combined.set(hit.messageId, { hit, score: contribution });
    });
  }
  return [...combined.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ hit, score }) => ({ ...hit, score }));
}

export async function searchMemory(input: SearchMemoryInput): Promise<SearchMemoryOutput> {
  const query = input.query.trim();
  if (!query) return { mode: 'text', items: [] };
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 8), 20));
  // Some model/tool clients send an empty string for an omitted optional field.
  // Treat it as no conversation filter before PostgreSQL casts it to UUID.
  const conversationId = input.conversationId?.trim() || undefined;
  const filter = { userId: input.userId, conversationId };
  const textHits = await searchIndex.searchText(query, filter, limit);
  if (!embeddingProvider) return { mode: 'text', items: textHits };

  try {
    const [queryVector] = await embeddingProvider.embed([query]);
    const semanticHits = await searchIndex.searchVector(queryVector, filter, limit);
    return { mode: 'hybrid', items: fuseResults(textHits, semanticHits, limit) };
  } catch (error) {
    console.warn(`memory semantic search unavailable; using text search: ${error instanceof Error ? error.message : String(error)}`);
    return { mode: 'text', items: textHits };
  }
}

async function processPendingBatch(): Promise<boolean> {
  if (!embeddingProvider) return false;
  const documents = await searchIndex.claimPending(BATCH_SIZE);
  if (documents.length === 0) return false;
  try {
    const vectors = await embeddingProvider.embed(documents.map((document) => `${document.role}: ${document.content}`));
    if (vectors.length !== documents.length) throw new Error('Embedding batch size mismatch');
    await Promise.all(documents.map((document, index) =>
      searchIndex.saveEmbedding(document.messageId, embeddingProvider.model, vectors[index]),
    ));
  } catch (error) {
    const delay = Math.min(1_000 * 2 ** Math.min(documents.length, 8), MAX_RETRY_MS);
    await Promise.all(documents.map((document) => searchIndex.retryEmbedding(document.messageId, delay)));
    console.warn(`memory embedding batch failed; scheduled retry: ${error instanceof Error ? error.message : String(error)}`);
  }
  return true;
}

/** Background, persisted queue: restarts and provider outages do not lose indexing work. */
export function startEmbeddingWorker(): void {
  if (!embeddingProvider) {
    console.info('memory semantic indexing disabled (configure MEMORY_EMBEDDING_CONFIG or MEMORY_EMBEDDING_API_KEY)');
    return;
  }
  const run = async () => {
    try {
      while (await processPendingBatch()) {
        // Drain queued work without waiting between batches.
      }
    } catch (error) {
      console.error(`memory embedding worker error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTimeout(() => void run(), POLL_MS).unref();
    }
  };
  void run();
}
