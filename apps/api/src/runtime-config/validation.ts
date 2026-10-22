import type { RuntimeSettings } from './contracts.js';
import { validateAuthSettings } from '../auth/settings.js';
import { RUNTIME_CONFIG_POSITIVE_INTEGER_FIELDS, RUNTIME_CONFIG_PROVIDER_NAMES } from './constants.js';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

function normalizeCatalog(items: unknown, field: string, provider: string, allowEmpty = false): string[] {
  if (!Array.isArray(items) || (!allowEmpty && items.length === 0) || items.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Invalid ${field} for ${provider}`);
  }
  return [...new Set(items.map((item: string) => item.trim()))];
}

function normalizeProvider(name: string, provider: any): void {
  if (!(RUNTIME_CONFIG_PROVIDER_NAMES as readonly string[]).includes(name) || !provider || typeof provider.apiKey !== 'string' || !provider.apiKey.trim() || provider.apiKey === 'replace-me') {
    throw new Error('Invalid provider: ' + name);
  }

  if (provider.voice !== undefined) throw new Error('provider.voice is no longer supported; use provider.realtime');
  // Older persisted settings may still contain this retired per-model metadata.
  // Strip it during normalization so it cannot leak back into the admin editor.
  delete provider.contextWindows;
  if (provider.realtime !== undefined && (name !== 'openai' || !provider.realtime || typeof provider.realtime !== 'object' || Array.isArray(provider.realtime))) {
    throw new Error('Realtime configuration is currently supported only for OpenAI');
  }

  const models = provider.models;
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw new Error('Invalid models for ' + name);
  const chatModels = normalizeCatalog(models.chat, 'models.chat', name);
  const normalizedModels: { chat: string[]; embeddings?: string[]; realtime?: string[] } = { chat: chatModels };
  if (models.embeddings !== undefined) {
    normalizedModels.embeddings = normalizeCatalog(models.embeddings, 'models.embeddings', name, true);
  }
  if (models.realtime !== undefined) {
    if (name !== 'openai') throw new Error('Realtime models are currently supported only for OpenAI');
    normalizedModels.realtime = normalizeCatalog(models.realtime, 'models.realtime', name, true);
  }
  provider.models = normalizedModels;

  if (name === 'openai') {
    const rawBaseUrl = provider.baseUrl ?? OPENAI_BASE_URL;
    if (typeof rawBaseUrl !== 'string' || !rawBaseUrl.trim()) throw new Error('Invalid baseUrl for ' + name);
    const baseUrl = rawBaseUrl.trim();
    const parsedUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) throw new Error('Invalid baseUrl for ' + name);
    provider.baseUrl = baseUrl.replace(/\/+$/, '');

    const realtime = provider.realtime;
    if (realtime !== undefined) {
      if (!realtime || typeof realtime !== 'object' || Array.isArray(realtime)) throw new Error('Invalid realtime configuration for ' + name);
      if (!normalizedModels.realtime?.length) throw new Error('models.realtime is required when realtime is configured');
      const voices = normalizeCatalog(realtime.voices, 'realtime.voices', name);
      provider.realtime = { voices };
    } else if (normalizedModels.realtime?.length) {
      throw new Error('realtime.voices is required when models.realtime is configured');
    }
  } else {
    if (provider.baseUrl !== undefined) throw new Error('baseUrl is currently configurable only for OpenAI');
    if (provider.realtime !== undefined) throw new Error('Realtime configuration is currently supported only for OpenAI');
  }
}

/** Valida y normaliza una configuración runtime procedente de almacenamiento o de la API. */
export function validateRuntimeSettings(value: unknown): RuntimeSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Settings must be an object');
  const v = structuredClone(value) as Record<string, any>;
  Object.assign(v, validateAuthSettings(v));
  if (!v.ai || typeof v.ai !== 'object' || Array.isArray(v.ai) || !v.ai.providers || typeof v.ai.providers !== 'object' || Array.isArray(v.ai.providers)) throw new Error('ai.providers is required');
  v.ai = { providers: v.ai.providers };
  for (const [name, provider] of Object.entries(v.ai.providers) as [string, any][]) normalizeProvider(name, provider);
  if (!v.mcpConfig || typeof v.mcpConfig !== 'object' || Array.isArray(v.mcpConfig)) throw new Error('mcpConfig must be an object');
  for (const [name, mcp] of Object.entries(v.mcpConfig) as [string, any][]) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || !mcp || typeof mcp.url !== 'string') throw new Error('Invalid MCP: ' + name);
    const mcpUrl = new URL(mcp.url);
    if (!['http:', 'https:'].includes(mcpUrl.protocol) || mcpUrl.username || mcpUrl.password) throw new Error('Invalid MCP URL: ' + name);
    if (mcp.headers !== undefined && (!mcp.headers || typeof mcp.headers !== 'object' || Array.isArray(mcp.headers) || Object.values(mcp.headers).some((header) => typeof header !== 'string'))) throw new Error('Invalid MCP headers: ' + name);
    if (mcp.auth != null && typeof mcp.auth !== 'string') throw new Error('Invalid MCP auth: ' + name);
    if (mcp.optional !== undefined && typeof mcp.optional !== 'boolean') throw new Error('Invalid MCP optional flag: ' + name);
    mcp.url = mcp.url.trim();
    mcp.headers ??= {};
    mcp.auth ??= null;
    mcp.optional ??= false;
  }
  v.embeddingConfig ??= null;
  if (v.embeddingConfig && typeof v.embeddingConfig === 'object' && typeof v.embeddingConfig.apiKey === 'string' && typeof v.embeddingConfig.baseUrl === 'string' && typeof v.embeddingConfig.model === 'string') {
    // Migrate the previous standalone embedding credentials only when they exactly match a configured provider.
    const legacy = v.embeddingConfig;
    const legacyUrl = legacy.baseUrl.trim().replace(/\/+$/, '');
    const matchingProvider = Object.entries(v.ai.providers).find(([name, provider]: [string, any]) =>
      provider.apiKey === legacy.apiKey.trim()
      && (provider.baseUrl ?? (name === 'openrouter' ? 'https://openrouter.ai/api/v1' : OPENAI_BASE_URL)) === legacyUrl,
    );
    if (!matchingProvider) throw new Error('Legacy embedding credentials do not match a configured provider; move the key and endpoint to Provider before selecting its embedding model');
    const [providerName, provider] = matchingProvider as [string, any];
    const legacyModel = legacy.model.trim().startsWith(`${providerName}/`)
      ? legacy.model.trim().slice(providerName.length + 1)
      : legacy.model.trim();
    provider.models.embeddings = [...new Set([...(provider.models.embeddings ?? []), legacyModel])];
    v.embeddingConfig = { model: `${providerName}/${legacyModel}` };
  }
  if (v.embeddingConfig !== null) {
    const embedding = v.embeddingConfig;
    if (!embedding || typeof embedding !== 'object' || Array.isArray(embedding) || typeof embedding.model !== 'string' || !embedding.model.trim()) {
      throw new Error('Invalid embeddingConfig: provide a selected model as provider/model');
    }
    const modelId = embedding.model.trim();
    const slash = modelId.indexOf('/');
    if (slash <= 0 || slash === modelId.length - 1) throw new Error('Invalid embeddingConfig.model: expected provider/model');
    const providerName = modelId.slice(0, slash);
    const modelName = modelId.slice(slash + 1);
    const provider = v.ai.providers[providerName];
    if (!provider || !provider.models.embeddings?.includes(modelName)) {
      throw new Error(`embeddingConfig.model ${modelId} is not listed in ai.providers.${providerName}.models.embeddings`);
    }
    embedding.model = modelId;
    v.embeddingConfig = { model: modelId };
  }
  if (Object.hasOwn(v, 'responseTokenReserve')) {
    throw new Error('responseTokenReserve is no longer supported; provide maxOutputTokens and reserveOutputTokens');
  }
  for (const field of RUNTIME_CONFIG_POSITIVE_INTEGER_FIELDS) {
    if (!Number.isInteger(v[field]) || v[field] < 1) throw new Error(field + ' must be a positive integer');
  }
  if (v.reserveOutputTokens < v.maxOutputTokens) throw new Error('reserveOutputTokens must be greater than or equal to maxOutputTokens');
  if (typeof v.chatSystemPrompt !== 'string' || typeof v.llmTraceRequests !== 'boolean' || typeof v.summariesEnabled !== 'boolean') throw new Error('Invalid chat settings');
  return v as RuntimeSettings;
}
