import type { EmbeddingProvider } from './contracts.js';

const EMBEDDING_DIMENSIONS = 1536;

type EmbeddingsResponse = {
  data?: Array<{ index?: number; embedding?: number[] }>;
  error?: { message?: string };
};

/** OpenAI-compatible API adapter. Disabled when no embedding API key is configured. */
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(options: { baseUrl: string; apiKey: string; model: string }) {
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/embeddings`;
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => ({}))) as EmbeddingsResponse;
    if (!response.ok) {
      throw new Error(`Embedding provider returned HTTP ${response.status}: ${payload.error?.message ?? 'request failed'}`);
    }

    const rows = payload.data;
    if (!Array.isArray(rows) || rows.length !== texts.length) {
      throw new Error('Embedding provider returned an unexpected number of vectors');
    }
    const ordered = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return ordered.map((row) => {
      const vector = row.embedding;
      if (
        !Array.isArray(vector) ||
        vector.length !== EMBEDDING_DIMENSIONS ||
        vector.some((value) => !Number.isFinite(value))
      ) {
        throw new Error(`Embedding vector must contain ${EMBEDDING_DIMENSIONS} finite values`);
      }
      return vector;
    });
  }
}
