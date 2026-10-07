-- La database `memory` queda solo para el Memory MCP: el runtime no persiste sesiones ni identidades.
DROP TABLE IF EXISTS "unidentified";
DROP TABLE IF EXISTS "identities";

-- Alinea con schema.prisma (el init había quedado con tenant obligatorio en el índice).
ALTER TABLE "conversations" ALTER COLUMN "tenant_id" DROP NOT NULL;
DROP INDEX IF EXISTS "conversations_tenant_id_user_id_updated_at_idx";
CREATE INDEX "conversations_user_id_updated_at_idx" ON "conversations"("user_id", "updated_at" DESC);
