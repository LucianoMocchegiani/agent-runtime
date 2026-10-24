CREATE TABLE "conversation_objectives" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "steps" JSONB NOT NULL DEFAULT '[]',
  "next_step" VARCHAR(500),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_objectives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversation_objectives_conversation_id_key" UNIQUE ("conversation_id"),
  CONSTRAINT "conversation_objectives_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "conversation_objectives_status_check" CHECK ("status" IN ('active', 'blocked', 'completed'))
);
