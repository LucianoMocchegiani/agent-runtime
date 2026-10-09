import { prisma } from './prisma.js';
import { embeddingProvider } from './search/service.js';
import type {
  DeletePreferenceParams,
  ListPreferencesParams,
  SavePreferenceParams,
  SearchPreferencesParams,
  UserPreferenceDto,
} from 'agent-runtime-memory-contract';

const EMBEDDING_DIMENSIONS = 1536;
const MIN_SEMANTIC_SCORE = 0.34;
const MIN_TEXT_SCORE = 0.30;

type PreferenceRow = {
  id: string;
  preference: string;
  activationCondition: string;
  category: string | null;
  createdAt: Date | string;
  score?: number;
};

function vectorLiteral(vector: number[]): string {
  if (vector.length !== EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Embedding vector must contain ${EMBEDDING_DIMENSIONS} finite values`);
  }
  return `[${vector.join(',')}]`;
}

function toDto(row: PreferenceRow): UserPreferenceDto {
  return {
    id: row.id,
    preference: row.preference,
    activationCondition: row.activationCondition,
    category: row.category,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    ...(row.score === undefined ? {} : { score: row.score }),
  };
}

export async function savePreference(params: SavePreferenceParams): Promise<UserPreferenceDto> {
  const preference = params.preference.trim();
  const activationCondition = params.activationCondition.trim();
  if (!params.userId.trim() || !preference || !activationCondition) {
    throw new Error('userId, preference, and activationCondition are required');
  }

  const [row] = await prisma.$queryRaw<PreferenceRow[]>`
    INSERT INTO memory_user_preferences (user_id, preference, activation_condition, category)
    VALUES (${params.userId}, ${preference}, ${activationCondition}, ${params.category?.trim() || null})
    RETURNING id, preference, activation_condition AS "activationCondition",
      category, created_at AS "createdAt"
  `;

  // Keep the preference even when embeddings are not configured or temporarily unavailable.
  if (embeddingProvider) {
    try {
      const [vector] = await embeddingProvider.embed([`${preference}\n${activationCondition}`]);
      await prisma.$executeRaw`
        UPDATE memory_user_preferences
        SET embedding = ${vectorLiteral(vector)}::vector, embedding_model = ${embeddingProvider.model}, updated_at = now()
        WHERE id = ${row.id}::uuid AND user_id = ${params.userId}
      `;
    } catch (error) {
      console.warn(`preference embedding unavailable; saved preference will use text search: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return toDto(row);
}

export async function listPreferences(params: ListPreferencesParams): Promise<UserPreferenceDto[]> {
  const rows = await prisma.$queryRaw<PreferenceRow[]>`
    SELECT id, preference, activation_condition AS "activationCondition", category,
      created_at AS "createdAt"
    FROM memory_user_preferences
    WHERE user_id = ${params.userId}
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return rows.map(toDto);
}

export async function deletePreference(params: DeletePreferenceParams): Promise<boolean> {
  const deleted = await prisma.$executeRaw`
    DELETE FROM memory_user_preferences
    WHERE id = ${params.id}::uuid AND user_id = ${params.userId}
  `;
  return deleted === 1;
}

export async function searchPreferences(params: SearchPreferencesParams): Promise<UserPreferenceDto[]> {
  const query = params.query.trim();
  if (!query || !params.userId.trim()) return [];
  const limit = Math.max(1, Math.min(Math.floor(params.limit ?? 5), 10));
  const candidates = new Map<string, PreferenceRow>();

  const [textRows, existingRows] = await Promise.all([
    prisma.$queryRaw<PreferenceRow[]>`
      SELECT id, preference, activation_condition AS "activationCondition", category,
        created_at AS "createdAt",
        GREATEST(
          similarity(preference, ${query}),
          similarity(activation_condition, ${query})
        )::float8 AS score
      FROM memory_user_preferences
      WHERE user_id = ${params.userId}
        AND (preference % ${query} OR activation_condition % ${query})
      ORDER BY score DESC, created_at DESC
      LIMIT ${limit * 3}
    `,
    prisma.$queryRaw<Array<{ hasPreferences: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM memory_user_preferences
        WHERE user_id = ${params.userId}
      ) AS "hasPreferences"
    `,
  ]);
  for (const row of textRows) {
    if ((row.score ?? 0) >= MIN_TEXT_SCORE) candidates.set(row.id, row);
  }

  if (embeddingProvider && existingRows[0]?.hasPreferences) {
    try {
      const [queryVector] = await embeddingProvider.embed([query]);
      const literal = vectorLiteral(queryVector);
      const semanticRows = await prisma.$queryRaw<PreferenceRow[]>`
        SELECT id, preference, activation_condition AS "activationCondition", category,
          created_at AS "createdAt",
          (1 - (embedding <=> ${literal}::vector))::float8 AS score
        FROM memory_user_preferences
        WHERE user_id = ${params.userId} AND embedding IS NOT NULL
          AND embedding_model = ${embeddingProvider.model}
        ORDER BY embedding <=> ${literal}::vector
        LIMIT ${limit * 3}
      `;
      for (const row of semanticRows) {
        const score = row.score ?? 0;
        if (score < MIN_SEMANTIC_SCORE) continue;
        const current = candidates.get(row.id);
        candidates.set(row.id, { ...row, score: Math.max(score, current?.score ?? 0) });
      }
    } catch (error) {
      console.warn(`preference semantic search unavailable; using text search: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return [...candidates.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || Date.parse(String(b.createdAt)) - Date.parse(String(a.createdAt)))
    .slice(0, limit)
    .map(toDto);
}
