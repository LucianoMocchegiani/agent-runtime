import { config } from '../config.js';
import type { AgentProfile, AgentProfileConfig } from './contracts.js';
import {
  archiveAgentProfileRecord,
  insertAgentProfile,
  insertInitialDefaultProfile,
  readAgentProfile,
  readAgentProfiles,
  readFirstActiveAgentProfile,
  readNewChatDefaultProfileId,
  seedLegacyAgentProfile,
  updateAgentProfileRecord,
  writeNewChatDefaultProfileId,
} from './agent-profile-persistence.js';
import { validateAgentProfileInput } from './agent-profile-validation.js';

/** Lista perfiles activos o incluye los archivados cuando se solicita explícitamente. */
export async function listAgentProfiles(includeArchived = false): Promise<AgentProfile[]> {
  return readAgentProfiles(includeArchived);
}

/** Busca un perfil por identificador; devuelve null para archivados salvo indicación contraria. */
export async function getAgentProfile(id: string, includeArchived = false): Promise<AgentProfile | null> {
  return readAgentProfile(id, includeArchived);
}

/** Obtiene el perfil activo más antiguo y falla si no hay perfiles configurados. */
export async function getFirstActiveAgentProfile(): Promise<AgentProfile> {
  return readFirstActiveAgentProfile();
}

/** Resuelve el id del perfil predeterminado y usa el primer perfil activo como fallback. */
export async function getNewChatDefaultProfileId(): Promise<string> {
  const selectedId = await readNewChatDefaultProfileId();
  if (selectedId && await readAgentProfile(selectedId)) return selectedId;
  return (await readFirstActiveAgentProfile()).id;
}

/** Cambia el perfil predeterminado solo si el perfil elegido está activo. */
export async function setNewChatDefaultProfileId(profileId: string): Promise<boolean> {
  if (!await readAgentProfile(profileId)) return false;
  await writeNewChatDefaultProfileId(profileId);
  return true;
}

/** Inicializa la preferencia predeterminada solo cuando todavía no existe. */
export async function initializeNewChatDefaultProfile(): Promise<void> {
  const first = await readFirstActiveAgentProfile();
  await insertInitialDefaultProfile(first.id);
}

/** Resuelve el perfil completo que se asignará por defecto a conversaciones nuevas. */
export async function getNewChatDefaultAgentProfile(): Promise<AgentProfile> {
  return (await readAgentProfile(await getNewChatDefaultProfileId())) ?? readFirstActiveAgentProfile();
}

/** Valida y crea un perfil de agente activo. */
export async function createAgentProfile(input: { name: unknown; model: unknown; config: unknown }): Promise<AgentProfile> {
  return insertAgentProfile(validateAgentProfileInput(input.name, input.model, input.config));
}

/** Valida y actualiza un perfil activo; devuelve null si no existe o está archivado. */
export async function updateAgentProfile(id: string, input: { name: unknown; model: unknown; config: unknown }): Promise<AgentProfile | null> {
  return updateAgentProfileRecord(id, validateAgentProfileInput(input.name, input.model, input.config));
}

/** Archiva un perfil preservando la existencia de un perfil activo. */
export async function archiveAgentProfile(id: string): Promise<boolean> {
  return archiveAgentProfileRecord(id);
}

/** Migra la configuración heredada al primer perfil activo de forma segura entre réplicas. */
export async function seedDefaultAgentProfile(): Promise<void> {
  const legacyConfig: AgentProfileConfig = {
    systemPrompt: config.chatSystemPrompt,
    chat: {
      contextTokenBudget: config.contextTokenBudget,
      maxContextMessages: config.maxContextMessages,
      maxOutputTokens: config.maxOutputTokens,
      reserveOutputTokens: config.reserveOutputTokens,
      contextSafetyTokens: config.contextSafetyTokens,
      maxToolSteps: config.maxToolSteps,
      llmTraceRequests: config.llmTraceRequests,
      summariesEnabled: config.summariesEnabled,
      summaryTokenBudget: config.summaryTokenBudget,
    },
  };
  await seedLegacyAgentProfile(config.ai.defaultModel, legacyConfig);
}
