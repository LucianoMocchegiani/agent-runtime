// Public in-process Memory module consumed by the Runtime API.
export {
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
  ConversationNotFoundError,
} from './tools.js';
export { deletePreference, listPreferences, savePreference, searchPreferences } from './preferences.js';
export { searchMemory, startEmbeddingWorker, setEmbeddingConfig } from './search/service.js';
export { prisma } from './prisma.js';
