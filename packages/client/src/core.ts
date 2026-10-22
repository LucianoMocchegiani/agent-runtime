import { createAdminApi } from './admin.js';
import { createCatalogApi } from './catalog.js';
import { createConversationsApi } from './conversations.js';
import { createDelegationsApi } from './delegations.js';
import { createMessagesApi } from './messages.js';
import { createMcpConnectionsApi } from './mcp-connections.js';
import { createPreferencesApi } from './preferences.js';
import { createVoiceApi } from './voice.js';
import type { ClientConfig } from './types.js';

export { ClientError } from './client-error.js';
export type { McpOAuthConnection } from './mcp-connections.js';
export { isAbortError } from './abort.js';
export { consumeUiMessageStream } from './stream.js';
export type { AdminAgentProfile, AdminProfileList, AdminRuntimeConfig } from './admin.js';
export type {
  AgentProfileInfo,
  ClientConfig,
  Conversation,
  CursorPage,
  CursorPageOptions,
  Delegation,
  DelegationEvent,
  DelegationStatus,
  Message,
  MessageCursor,
  MessageListOptions,
  MessagePage,
  ModelInfo,
  ModelList,
  SavePreferenceOptions,
  SendOptions,
  StreamHandlers,
  UserPreference,
} from './types.js';

/**
 * Crea el cliente tipado de agent-runtime, agrupado por recurso de la API.
 * Las credenciales configuradas se consultan en cada solicitud.
 *
 * @param config URL base y callbacks de credenciales.
 * @returns Operaciones HTTP de conversaciones, mensajes, modelos, voz, preferencias y delegaciones.
 */
export function createClient(config: ClientConfig) {
  const catalog = createCatalogApi(config);
  return {
    admin: createAdminApi(config),
    conversations: createConversationsApi(config),
    preferences: createPreferencesApi(config),
    ...catalog,
    delegations: createDelegationsApi(config),
    voice: createVoiceApi(config),
    messages: createMessagesApi(config),
    mcpConnections: createMcpConnectionsApi(config),
  };
}
