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
export let embeddingProvider: EmbeddingProvider | null = configuredEmbeddingProvider();

let runtimeConfigVersion = -1;
function normalizeIdentity(baseUrl: string, model: string): string {
  return `${baseUrl.replace(/\/+$/, '')}\u0000${model}`;
}
function envEmbeddingIdentity(): string {
  let parsed: EmbeddingConfig = {};
  try {
    const raw = process.env.MEMORY_EMBEDDING_CONFIG?.trim();
    if (raw) parsed = JSON.parse(raw) as EmbeddingConfig;
  } catch { /* configuredEmbeddingProvider reports malformed JSON during startup */ }
  const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : process.env.MEMORY_EMBEDDING_API_KEY?.trim();
  if (!apiKey || apiKey === 'replace-me') return '';
  const baseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : process.env.MEMORY_EMBEDDING_BASE_URL?.trim() || 'https://api.openai.com/v1';
  const model = typeof parsed.model === 'string' ? parsed.model.trim() : process.env.MEMORY_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
  return normalizeIdentity(baseUrl, model);
}
let activeEmbeddingIdentity = envEmbeddingIdentity();

async function refreshRuntimeEmbeddingConfig(): Promise<void> {
  const endpoint = process.env.AGENT_RUNTIME_CONFIG_URL?.trim();
  const token = process.env.RUNTIME_CONFIG_INTERNAL_TOKEN?.trim();
  if (!endpoint || !token) return;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`runtime embedding config returned HTTP ${response.status}`);
  const result = await response.json() as { version?: unknown; embeddingConfig?: unknown };
  if (!Number.isSafeInteger(result.version) || (result.version as number) < 1 || (result.version as number) <= runtimeConfigVersion) return;
  const value = result.embeddingConfig;
  let next: EmbeddingProvider | null = null;
  let nextIdentity = '';
  if (value !== null) {
    if (!value || typeof value !== 'object') throw new Error('runtime embedding config is invalid');
    const cfg = value as { apiKey?: unknown; baseUrl?: unknown; model?: unknown };
    if (typeof cfg.apiKey !== 'string' || !cfg.apiKey || typeof cfg.baseUrl !== 'string' || typeof cfg.model !== 'string') throw new Error('runtime embedding config is invalid');
    const url = new URL(cfg.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('runtime embedding URL is invalid');
    if (!cfg.model.trim() || cfg.apiKey === 'replace-me') throw new Error('runtime embedding config is invalid');
    nextIdentity = normalizeIdentity(cfg.baseUrl, cfg.model);
    next = new OpenAiCompatibleEmbeddingProvider({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model });
  }
  if (next && nextIdentity !== activeEmbeddingIdentity) {
    await searchIndex.requeueAllEmbeddings();
  }
  embeddingProvider = next;
  activeEmbeddingIdentity = nextIdentity;
  runtimeConfigVersion = result.version as number;
}

export async function syncRuntimeEmbeddingConfig(): Promise<void> {
  await refreshRuntimeEmbeddingConfig();
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
      await refreshRuntimeEmbeddingConfig();
      if (embeddingProvider) {
        // Bound each drain cycle so config changes are observed even while a large
        // reindex queue is being processed. Without this, a full queue could keep
        // the old provider active until every document had been re-embedded.
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
