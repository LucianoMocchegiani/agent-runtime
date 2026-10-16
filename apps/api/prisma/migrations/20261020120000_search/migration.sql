-- Search index is rebuildable; original messages remain the source of truth.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE memory_search_documents (
  message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED,
  embedding vector(1536),
  embedding_model TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX memory_search_documents_owner_idx
  ON memory_search_documents (user_id, conversation_id);
CREATE INDEX memory_search_documents_text_idx
  ON memory_search_documents USING GIN (search_vector);
CREATE INDEX memory_search_documents_trigram_idx
  ON memory_search_documents USING GIN (content gin_trgm_ops);
CREATE INDEX memory_search_documents_embedding_idx
  ON memory_search_documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX memory_search_documents_queue_idx
  ON memory_search_documents (status, next_attempt_at, locked_at);

-- A trigger keeps the durable embedding queue in the same transaction as each message.
CREATE FUNCTION enqueue_memory_search_document() RETURNS trigger AS $$
DECLARE
  owner_id TEXT;
BEGIN
  IF NEW.role NOT IN ('user', 'assistant') OR length(btrim(NEW.content)) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO owner_id FROM conversations WHERE id = NEW.conversation_id;
  INSERT INTO memory_search_documents
    (message_id, conversation_id, user_id, role, content, status, attempts, next_attempt_at)
  VALUES
    (NEW.id, NEW.conversation_id, owner_id, NEW.role, NEW.content, 'pending', 0, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_enqueue_search_document
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION enqueue_memory_search_document();

-- Backfill existing user/assistant messages; the worker fills vectors asynchronously.
INSERT INTO memory_search_documents
  (message_id, conversation_id, user_id, role, content, status, attempts, next_attempt_at)
SELECT m.id, m.conversation_id, c.user_id, m.role, m.content, 'pending', 0, now()
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
WHERE m.role IN ('user', 'assistant') AND length(btrim(m.content)) > 0
ON CONFLICT (message_id) DO NOTHING;
