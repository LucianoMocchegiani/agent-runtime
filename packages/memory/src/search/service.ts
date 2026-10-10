import type { EmbeddingProvider, SearchHit, SearchIndex } from './contracts.js';
import { OpenAiCompatibleEmbeddingProvider } from './embedding-provider.js';
import { PostgresSearchIndex } from './postgres-index.js';

const BATCH_SIZE = 16;
const MAX_BATCHES_PER_CYCLE = 8;
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

export const searchIndex: SearchIndex = new PostgresSearchIndex();
// Runtime owns embedding credentials and injects the saved value directly.
export let embeddingProvider: EmbeddingProvider | null = null;
let activeEmbeddingIdentity = '';

export async function setEmbeddingConfig(value: { apiKey: string; baseUrl: string; model: string } | null): Promise<void> {
  let next: EmbeddingProvider | null = null;
  let nextIdentity = '';
  if (value) {
    const url = new URL(value.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('runtime embedding URL is invalid');
    if (!value.apiKey.trim() || value.apiKey === 'replace-me' || !value.model.trim()) throw new Error('runtime embedding config is invalid');
    nextIdentity = `${value.baseUrl.replace(/\/+$/, '')}\u0000${value.model}`;
    next = new OpenAiCompatibleEmbeddingProvider(value);
  }
  if (nextIdentity !== activeEmbeddingIdentity && next) await searchIndex.requeueAllEmbeddings();
  embeddingProvider = next;
  activeEmbeddingIdentity = nextIdentity;
}

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
  const provider = embeddingProvider;
  if (!provider) return { mode: 'text', items: textHits };

  try {
    const [queryVector] = await provider.embed([query]);
    const semanticHits = await searchIndex.searchVector(queryVector, filter, limit, provider.model);
    return { mode: 'hybrid', items: fuseResults(textHits, semanticHits, limit) };
  } catch (error) {
    console.warn(`memory semantic search unavailable; using text search: ${error instanceof Error ? error.message : String(error)}`);
    return { mode: 'text', items: textHits };
  }
}

async function processPendingBatch(): Promise<boolean> {
  const provider = embeddingProvider;
  if (!provider) return false;
  const documents = await searchIndex.claimPending(BATCH_SIZE);
  if (documents.length === 0) return false;
  try {
    const vectors = await provider.embed(documents.map((document) => `${document.role}: ${document.content}`));
    if (vectors.length !== documents.length) throw new Error('Embedding batch size mismatch');
    await Promise.all(documents.map((document, index) =>
      searchIndex.saveEmbedding(document.messageId, provider.model, vectors[index]),
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
  let lastWarningAt = 0;
  const run = async () => {
    try {
      if (embeddingProvider) {
        // Bound each drain cycle so the worker yields regularly under large queues.
        for (let batch = 0; batch < MAX_BATCHES_PER_CYCLE; batch += 1) {
          if (!(await processPendingBatch())) break;
        }
      }
    } catch (error) {
      if (Date.now() - lastWarningAt >= 30_000) {
        console.warn(`memory embedding/config sync unavailable: ${error instanceof Error ? error.message : String(error)}`);
        lastWarningAt = Date.now();
      }
    } finally {
      setTimeout(() => void run(), POLL_MS).unref();
    }
  };
  void run();
}
