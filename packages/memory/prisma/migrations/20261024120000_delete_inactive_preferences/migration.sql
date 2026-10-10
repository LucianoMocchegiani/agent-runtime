-- Preferences are either retained or permanently deleted; there is no inactive state.
-- Remove previously deactivated records before dropping the state column so they cannot
-- become eligible for automatic retrieval again.
DELETE FROM memory_user_preferences WHERE active = FALSE;

DROP INDEX IF EXISTS memory_user_preferences_owner_active_idx;
ALTER TABLE memory_user_preferences DROP COLUMN active;

CREATE INDEX memory_user_preferences_owner_created_idx
  ON memory_user_preferences (user_id, created_at DESC);
