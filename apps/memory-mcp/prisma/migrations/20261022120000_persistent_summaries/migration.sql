-- Persisted rolling conversation summaries. Existing messages remain untouched.
ALTER TABLE conversations
  ADD COLUMN summary TEXT,
  ADD COLUMN summary_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN summary_through_message_id UUID,
  ADD COLUMN summary_through_created_at TIMESTAMPTZ;
