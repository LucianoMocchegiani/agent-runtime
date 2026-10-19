import type { RuntimeSettings } from './contracts.js';
import { validateAuthSettings } from '../auth/settings.js';
import { RUNTIME_CONFIG_POSITIVE_INTEGER_FIELDS, RUNTIME_CONFIG_PROVIDER_NAMES } from './constants.js';

/** Valida y normaliza una configuración runtime procedente de almacenamiento o de la API. */
export function validateRuntimeSettings(value: unknown): RuntimeSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Settings must be an object');
  const v = structuredClone(value) as Record<string, any>;
  Object.assign(v, validateAuthSettings(v));
  if (!v.ai || typeof v.ai !== 'object' || Array.isArray(v.ai) || !v.ai.providers || typeof v.ai.providers !== 'object' || Array.isArray(v.ai.providers)) throw new Error('ai.providers is required');
  if (typeof v.ai.defaultModel !== 'string') throw new Error('ai.defaultModel is required');
  for (const [name, provider] of Object.entries(v.ai.providers) as [string, any][]) {
    if (!(RUNTIME_CONFIG_PROVIDER_NAMES as readonly string[]).includes(name) || !provider || typeof provider.apiKey !== 'string' || !provider.apiKey.trim() || provider.apiKey === 'replace-me') throw new Error('Invalid provider: ' + name);
    if (!Array.isArray(provider.models) || provider.models.length === 0 || provider.models.some((model: unknown) => typeof model !== 'string' || !model.trim())) throw new Error('Invalid models for ' + name);
    if (provider.contextWindows !== undefined && (!provider.contextWindows || typeof provider.contextWindows !== 'object' || Array.isArray(provider.contextWindows) || Object.values(provider.contextWindows).some((n: any) => !Number.isInteger(n) || n < 1))) throw new Error('Invalid contextWindows for ' + name);
    provider.models = [...new Set(provider.models.map((model: string) => model.trim()))];
    provider.contextWindows ??= {};
  }
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
  if (v.embeddingConfig !== null) {
    const embedding = v.embeddingConfig;
    if (!embedding || typeof embedding !== 'object' || typeof embedding.apiKey !== 'string' || !embedding.apiKey.trim() || embedding.apiKey === 'replace-me' || typeof embedding.baseUrl !== 'string' || typeof embedding.model !== 'string' || !embedding.model.trim()) throw new Error('Invalid embeddingConfig');
    const embeddingUrl = new URL(embedding.baseUrl);
    if (!['http:', 'https:'].includes(embeddingUrl.protocol) || embeddingUrl.username || embeddingUrl.password) throw new Error('Invalid embeddingConfig.baseUrl');
    embedding.baseUrl = embedding.baseUrl.replace(/\/+$/, '');
    embedding.model = embedding.model.trim();
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
