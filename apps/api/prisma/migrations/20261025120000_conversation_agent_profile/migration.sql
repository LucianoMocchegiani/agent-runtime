ALTER TABLE "conversations" ADD COLUMN "agent_profile_id" TEXT;
CREATE INDEX "conversations_agent_profile_id_idx" ON "conversations"("agent_profile_id");
