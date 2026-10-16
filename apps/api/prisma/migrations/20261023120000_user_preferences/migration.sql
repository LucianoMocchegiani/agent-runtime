-- Preferences are distinct from conversation memories and belong to one user.
CREATE TABLE memory_user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  preference TEXT NOT NULL CHECK (length(btrim(preference)) > 0),
  activation_condition TEXT NOT NULL CHECK (length(btrim(activation_condition)) > 0),
  category TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  embedding vector(1536),
  embedding_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX memory_user_preferences_owner_active_idx
  ON memory_user_preferences (user_id, active, created_at DESC);
CREATE INDEX memory_user_preferences_embedding_idx
  ON memory_user_preferences USING hnsw (embedding vector_cosine_ops);
CREATE INDEX memory_user_preferences_preference_trigram_idx
  ON memory_user_preferences USING GIN (preference gin_trgm_ops);
CREATE INDEX memory_user_preferences_condition_trigram_idx
  ON memory_user_preferences USING GIN (activation_condition gin_trgm_ops);
