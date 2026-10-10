-- Runtime profile selection is global and belongs to Runtime, not Memory.
-- Drop artifacts from the earlier cross-service conversation/profile coupling.
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_agent_profile_id_fkey";
DROP INDEX IF EXISTS "conversations_agent_profile_id_idx";
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "agent_profile_id";
