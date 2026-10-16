/** Interfaz de operaciones ofrecidas por el módulo Memory. */

import type {
  ArchiveConversationParams,
  ApplyTitleParams,
  ConversationDto,
  CreateConversationParams,
  GetConversationParams,
  ListConversationsParams,
  UpdateConversationParams,
} from './conversations.js';
import type {
  EditMessageParams,
  EditMessageResult,
  GetContextParams,
  GetContextResult,
  ListMessagesParams,
  ListMessagesResult,
  SaveMessageParams,
  SaveSummaryParams,
} from './messages.js';
import type { MemorySearchParams, MemorySearchResult } from './search.js';
import type {
  DeletePreferenceParams,
  ListPreferencesParams,
  SavePreferenceParams,
  SearchPreferencesParams,
  UserPreferenceDto,
} from './preferences.js';

/** Interfaz pública de operaciones ofrecidas por el módulo Memory. */
export interface MemoryService {
  /** Carga historial reciente y estado del resumen de una conversación propia. */
  getContext(params: GetContextParams): Promise<GetContextResult>;
  /** Guarda un resumen si la revisión esperada sigue vigente. */
  saveSummary(params: SaveSummaryParams): Promise<boolean>;
  /** Persiste un mensaje asociado a una conversación propia. */
  saveMessage(params: SaveMessageParams): Promise<void>;
  /** Edita un mensaje y elimina transaccionalmente los mensajes posteriores. */
  editMessageAndTruncate(params: EditMessageParams): Promise<EditMessageResult>;
  /** Obtiene una página cronológica de mensajes. */
  listMessages(params: ListMessagesParams): Promise<ListMessagesResult>;
  /** Lista conversaciones propias con filtro opcional de archivo. */
  listConversations(params: ListConversationsParams): Promise<ConversationDto[]>;
  /** Crea una conversación para el usuario indicado. */
  createConversation(params: CreateConversationParams): Promise<ConversationDto>;
  /** Obtiene una conversación propia o falla si no existe/no pertenece al usuario. */
  getConversation(params: GetConversationParams): Promise<ConversationDto>;
  /** Aplica cambios a una conversación propia. */
  updateConversation(params: UpdateConversationParams): Promise<ConversationDto>;
  /** Archiva una conversación propia sin eliminarla. */
  archiveConversation(params: ArchiveConversationParams): Promise<ConversationDto>;
  /** Aplica el título inicial si la conversación todavía no tiene uno. */
  applyAutomaticTitle(params: ApplyTitleParams): Promise<string | null>;
  /** Busca mensajes pertinentes, en modo textual o híbrido. */
  searchMemory(params: MemorySearchParams): Promise<MemorySearchResult>;
  /** Guarda una preferencia persistente para el usuario. */
  savePreference(params: SavePreferenceParams): Promise<UserPreferenceDto>;
  /** Lista las preferencias persistentes del usuario. */
  listPreferences(params: ListPreferencesParams): Promise<UserPreferenceDto[]>;
  /** Recupera preferencias relacionadas con una consulta contextual. */
  searchPreferences(params: SearchPreferencesParams): Promise<UserPreferenceDto[]>;
  /** Elimina una preferencia propia; informa si encontró y borró el registro. */
  deletePreference(params: DeletePreferenceParams): Promise<boolean>;
}
