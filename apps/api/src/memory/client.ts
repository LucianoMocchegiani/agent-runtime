import {
  getContext,
  saveSummary,
  saveMessage,
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
 * Adaptador interno de Memory. La API invoca el módulo directamente; no hay cliente MCP,
 * transporte HTTP ni proceso Memory separado.
 */
export function createMemoryClient(): MemoryService {
  return {
    getContext,
    saveSummary,
    saveMessage,
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
