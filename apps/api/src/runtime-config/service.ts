import { config } from '../config.js';
import { clearAuthCache } from '../auth/service.js';
import { setEmbeddingConfig } from '../memory-search/service.js';
import type { AgentProfile, EmbeddingConfig, RuntimeSettings } from './contracts.js';
import {
  assignLegacyConversationsToDefaultProfile,
  getPersistedRuntimeConfigVersion,
  isRuntimeConfigPersistenceEnabled,
  loadRuntimeConfig,
  RuntimeConfigPersistenceConflictError,
  saveRuntimeConfig,
  startRuntimeConfigPersistence,
} from './persistence.js';
import { initializeNewChatDefaultProfile, seedDefaultAgentProfile } from './agent-profiles.js';
import { RUNTIME_CONFIG_RELOAD_INTERVAL_MS } from './constants.js';
import { validateRuntimeSettings } from './validation.js';

let embeddingConfig: EmbeddingConfig = null;
let appliedVersion = 0;

async function applyEmbeddingProviderSettings(settings: RuntimeSettings): Promise<void> {
  const selection = settings.embeddingConfig;
  if (!selection) {
    await setEmbeddingConfig(null);
    return;
  }
  const separator = selection.model.indexOf('/');
  const providerName = selection.model.slice(0, separator) as keyof typeof settings.ai.providers;
  const model = selection.model.slice(separator + 1);
  const provider = settings.ai.providers[providerName];
  if (!provider) throw new Error(`Embedding provider ${providerName} is not configured`);
  const baseUrl = provider.baseUrl ?? 'https://openrouter.ai/api/v1';
  await setEmbeddingConfig({ apiKey: provider.apiKey, baseUrl, model });
}

function currentSettings(): RuntimeSettings {
  return {
    ai: config.ai,
    mcpConfig: config.mcpConfig,
    authIntrospectUrl: config.authIntrospectUrl,
    authMapping: config.authMapping,
    chatSystemPrompt: config.chatSystemPrompt,
    contextTokenBudget: config.contextTokenBudget,
    maxContextMessages: config.maxContextMessages,
    maxOutputTokens: config.maxOutputTokens,
    reserveOutputTokens: config.reserveOutputTokens,
    contextSafetyTokens: config.contextSafetyTokens,
    maxToolSteps: config.maxToolSteps,
    llmTraceRequests: config.llmTraceRequests,
    summariesEnabled: config.summariesEnabled,
    summaryTokenBudget: config.summaryTokenBudget,
    embeddingConfig,
  };
}

function authSettingsChanged(next: RuntimeSettings): boolean {
  return config.authIntrospectUrl !== next.authIntrospectUrl
    || JSON.stringify(config.authMapping) !== JSON.stringify(next.authMapping);
}

async function applyPersistedSettings(payload: unknown, version: number): Promise<void> {
  if (version <= appliedVersion) return;
  const next = validateRuntimeSettings(payload);
  if (authSettingsChanged(next)) clearAuthCache();
  Object.assign(config, next);
  embeddingConfig = next.embeddingConfig;
  await applyEmbeddingProviderSettings(next);
  appliedVersion = version;
}

/** Inicializa persistencia, migra perfiles heredados y sincroniza cambios de otras réplicas. */
export async function startRuntimeConfigStore(): Promise<void> {
  const initial = validateRuntimeSettings(currentSettings());
  const loaded = await startRuntimeConfigPersistence(initial);
  await applyPersistedSettings(loaded.payload, loaded.version);
  await seedDefaultAgentProfile();
  await initializeNewChatDefaultProfile();
  await assignLegacyConversationsToDefaultProfile();

  const poll = () => {
    void loadRuntimeConfig()
      .then(({ version, payload }) => applyPersistedSettings(payload, version))
      .catch((error: unknown) => console.error('runtime config reload failed', error));
  };
  const timer = setInterval(poll, RUNTIME_CONFIG_RELOAD_INTERVAL_MS);
  timer.unref();
}

/** Devuelve una copia aislada de los ajustes efectivos y aplica, si se indica, un perfil. */
export function getRuntimeSettings(profile?: Pick<AgentProfile, 'model' | 'config'>): RuntimeSettings {
  const current = structuredClone(currentSettings());
  if (profile) {
    current.ai.defaultModel = profile.model.chat;
    const profileConfig = structuredClone(profile.config);
    current.chatSystemPrompt = profileConfig.systemPrompt;
    Object.assign(current, profileConfig.chat);
  }
  return current;
}

/** Devuelve la versión sincronizada que se utiliza para el control optimista de escrituras. */
export function getRuntimeConfigVersion(): number { return appliedVersion || getPersistedRuntimeConfigVersion(); }

/** Indica si la configuración persistida está activa en esta réplica. */
export function isRuntimeConfigStoreEnabled(): boolean { return isRuntimeConfigPersistenceEnabled(); }

/** Error de dominio que la capa HTTP traduce a conflicto de escritura. */
export class RuntimeConfigConflictError extends Error {
  constructor() {
    super('Runtime config version conflict; reload the latest settings before saving');
    this.name = 'RuntimeConfigConflictError';
  }
}

/** Valida y guarda configuración de infraestructura con control optimista de versión. */
export async function saveRuntimeSettings(value: unknown, expectedVersion?: number): Promise<number> {
  const validated = validateRuntimeSettings(value);
  // Legacy chat/model fields remain readable only for migrations; profiles own them after startup.
  validated.ai.defaultModel = config.ai.defaultModel;
  validated.chatSystemPrompt = config.chatSystemPrompt;
  validated.contextTokenBudget = config.contextTokenBudget;
  validated.maxContextMessages = config.maxContextMessages;
  validated.maxOutputTokens = config.maxOutputTokens;
  validated.reserveOutputTokens = config.reserveOutputTokens;
  validated.contextSafetyTokens = config.contextSafetyTokens;
  validated.maxToolSteps = config.maxToolSteps;
  validated.llmTraceRequests = config.llmTraceRequests;
  validated.summariesEnabled = config.summariesEnabled;
  validated.summaryTokenBudget = config.summaryTokenBudget;
  const availableModels = new Set<string>();
  for (const [providerName, provider] of Object.entries(validated.ai.providers)) {
    for (const model of provider?.models.chat ?? []) availableModels.add(`${providerName}/${model}`);
  }

  let version: number;
  try {
    version = await saveRuntimeConfig(validated, expectedVersion, availableModels);
  } catch (error) {
    if (error instanceof RuntimeConfigPersistenceConflictError) throw new RuntimeConfigConflictError();
    throw error;
  }
  if (authSettingsChanged(validated)) clearAuthCache();
  Object.assign(config, validated);
  embeddingConfig = validated.embeddingConfig;
  await applyEmbeddingProviderSettings(validated);
  appliedVersion = version;
  return version;
}

/** Contratos expuestos históricamente por el módulo de configuración runtime. */
export type { AgentProfile, AgentProfileConfig, EmbeddingConfig, RuntimeSettings } from './contracts.js';
