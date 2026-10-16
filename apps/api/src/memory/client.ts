import {
  getContext,
  saveSummary,
  saveMessage,
  editMessageAndTruncate,
  listMessages,
  listConversations,
  createConversation,
  getConversation,
  updateConversation,
  archiveConversation,
  applyAutomaticTitle,
  searchMemory,
  savePreference,
  listPreferences,
  searchPreferences,
  deletePreference,
} from 'agent-runtime-memory';
import type { MemoryService } from 'agent-runtime-memory-contract';

/**
 * Adaptador del contrato Memory al módulo ejecutado dentro del mismo proceso.
 * No usa cliente MCP, transporte HTTP ni un proceso separado.
 */
/** Construye el adaptador de Memory que satisface el contrato usado por el agente. */
export function createMemoryClient(): MemoryService {
  return {
    getContext,
    saveSummary,
    saveMessage,
    editMessageAndTruncate,
    listMessages,
    listConversations,
    createConversation,
    getConversation,
    updateConversation,
    archiveConversation,
    applyAutomaticTitle,
    searchMemory,
    savePreference,
    listPreferences,
    searchPreferences,
    deletePreference,
  };
}
