import { prisma } from '../prisma.js';
import type {
  SearchDocument,
  SearchFilter,
  SearchHit,
  SearchIndex,
} from './contracts.js';

const EMBEDDING_DIMENSIONS = 1536;

type RawHit = Omit<SearchHit, 'createdAt'> & { createdAt: Date | string };

function vectorLiteral(vector: number[]): string {
  if (
    vector.length !== EMBEDDING_DIMENSIONS ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`Embedding vector must contain ${EMBEDDING_DIMENSIONS} finite values`);
  }
  return `[${vector.join(',')}]`;
}

function toHit(row: RawHit): SearchHit {
  return {
    ...row,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

/** PostgreSQL adapter; all DB-specific SQL and pgvector details stay behind SearchIndex. */
export class PostgresSearchIndex implements SearchIndex {
  async upsertDocument(document: SearchDocument): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO memory_search_documents
        (message_id, conversation_id, user_id, role, content, status, attempts, next_attempt_at)
      VALUES
        (${document.messageId}::uuid, ${document.conversationId}::uuid, ${document.userId},
         ${document.role}, ${document.content}, 'pending', 0, now())
      ON CONFLICT (message_id) DO UPDATE SET
        conversation_id = EXCLUDED.conversation_id,
        user_id = EXCLUDED.user_id,
        role = EXCLUDED.role,
        content = EXCLUDED.content,
        embedding = NULL,
        embedding_model = NULL,
        status = 'pending',
        attempts = 0,
        next_attempt_at = now(),
        locked_at = NULL
    `;
  }

  async claimPending(batchSize: number): Promise<SearchDocument[]> {
    return prisma.$queryRaw<SearchDocument[]>`
      WITH candidates AS (
        SELECT message_id
        FROM memory_search_documents
        WHERE (status = 'pending' AND next_attempt_at <= now())
           OR (status = 'processing' AND locked_at < now() - interval '5 minutes')
        ORDER BY next_attempt_at, message_id
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE memory_search_documents AS d
      SET status = 'processing', locked_at = now()
      FROM candidates AS c
      WHERE d.message_id = c.message_id
      RETURNING d.message_id AS "messageId", d.conversation_id AS "conversationId",
        d.user_id AS "userId", d.role, d.content
    `;
  }

  async saveEmbedding(messageId: string, model: string, vector: number[]): Promise<void> {
    const literal = vectorLiteral(vector);
    await prisma.$executeRaw`
      UPDATE memory_search_documents
      SET embedding = ${literal}::vector,
          embedding_model = ${model},
          status = 'ready',
          locked_at = NULL,
          last_error = NULL
      WHERE message_id = ${messageId}::uuid
    `;
  }

  async retryEmbedding(messageId: string, delayMs: number): Promise<void> {
    await prisma.$executeRaw`
      UPDATE memory_search_documents
      SET status = 'pending',
          attempts = attempts + 1,
          next_attempt_at = now() + (${delayMs} * interval '1 millisecond'),
          locked_at = NULL
      WHERE message_id = ${messageId}::uuid
    `;
  }

  async requeueAllEmbeddings(): Promise<void> {
    await prisma.$executeRaw`
      UPDATE memory_search_documents
      SET embedding = NULL, embedding_model = NULL, status = 'pending', attempts = 0,
          next_attempt_at = now(), locked_at = NULL, last_error = NULL
    `;
  }

  async searchText(query: string, filter: SearchFilter, limit: number): Promise<SearchHit[]> {
    const rows = await prisma.$queryRaw<RawHit[]>`
      SELECT m.id AS "messageId", m.conversation_id AS "conversationId",
        c.user_id AS "userId", m.role, m.content, m.created_at AS "createdAt",
        c.title, GREATEST(
          ts_rank_cd(d.search_vector, websearch_to_tsquery('simple', ${query})),
          similarity(d.content, ${query})
        )::float8 AS score
      FROM memory_search_documents d
      JOIN messages m ON m.id = d.message_id
      JOIN conversations c ON c.id = d.conversation_id
      WHERE d.user_id = ${filter.userId}
        AND (${filter.conversationId ?? null}::uuid IS NULL OR d.conversation_id = ${filter.conversationId ?? null}::uuid)
        AND (
          d.search_vector @@ websearch_to_tsquery('simple', ${query})
          OR d.content % ${query}
        )
      ORDER BY score DESC, m.created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(toHit);
  }

  async searchVector(vector: number[], filter: SearchFilter, limit: number, model: string): Promise<SearchHit[]> {
    const literal = vectorLiteral(vector);
    const rows = await prisma.$queryRaw<RawHit[]>`
      SELECT m.id AS "messageId", m.conversation_id AS "conversationId",
        c.user_id AS "userId", m.role, m.content, m.created_at AS "createdAt",
        c.title, (1 - (d.embedding <=> ${literal}::vector))::float8 AS score
      FROM memory_search_documents d
      JOIN messages m ON m.id = d.message_id
      JOIN conversations c ON c.id = d.conversation_id
      WHERE d.user_id = ${filter.userId}
        AND d.embedding IS NOT NULL
        AND d.embedding_model = ${model}
        AND (${filter.conversationId ?? null}::uuid IS NULL OR d.conversation_id = ${filter.conversationId ?? null}::uuid)
      ORDER BY d.embedding <=> ${literal}::vector
      LIMIT ${limit}
    `;
    return rows.map(toHit);
  }
}
