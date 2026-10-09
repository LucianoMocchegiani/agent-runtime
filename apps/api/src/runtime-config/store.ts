import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { config, type ChatConfig } from '../config.js';

export type EmbeddingConfig = { apiKey: string; baseUrl: string; model: string } | null;
export type RuntimeSettings = Pick<ChatConfig, 'ai' | 'mcpConfig' | 'chatSystemPrompt' | 'contextTokenBudget' | 'maxContextMessages' | 'maxOutputTokens' | 'reserveOutputTokens' | 'contextSafetyTokens' | 'maxToolSteps' | 'llmTraceRequests' | 'summariesEnabled' | 'summaryTokenBudget'> & { embeddingConfig: EmbeddingConfig };
type Settings = RuntimeSettings;

// Embeddings are opt-in and can only be configured in runtime.config.
let embeddingConfig: EmbeddingConfig = null;
let pool: Pool | undefined;
let key: Buffer | undefined;
let version = 0;

function settings(): Settings {
  return { ai: config.ai, mcpConfig: config.mcpConfig, chatSystemPrompt: config.chatSystemPrompt,
    contextTokenBudget: config.contextTokenBudget, maxContextMessages: config.maxContextMessages,
    maxOutputTokens: config.maxOutputTokens, reserveOutputTokens: config.reserveOutputTokens,
    contextSafetyTokens: config.contextSafetyTokens,
    maxToolSteps: config.maxToolSteps, llmTraceRequests: config.llmTraceRequests,
    summariesEnabled: config.summariesEnabled, summaryTokenBudget: config.summaryTokenBudget,
    embeddingConfig };
}
function encrypt(value: Settings): object {
  if (!key) throw new Error('Runtime config encryption is disabled');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decrypt(value: any): Settings {
  if (!key || value?.v !== 1 || typeof value.iv !== 'string' || typeof value.tag !== 'string' || typeof value.data !== 'string') throw new Error('Invalid encrypted runtime config');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return validateSettings(JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8')));
}
async function reload(): Promise<void> {
  if (!pool) return;
  const result = await pool.query<{ version: number; payload: unknown }>('SELECT version, payload FROM runtime.config WHERE id = $1', ['active']);
  const row = result.rows[0];
  if (row && row.version !== version) {
    const next = decrypt(row.payload);
    Object.assign(config, next);
    embeddingConfig = next.embeddingConfig;
    version = row.version;
  }
}

/** Runtime owns this schema; memory-mcp keeps its own tables and migrations separate. */
export async function startRuntimeConfigStore(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  const rawKey = process.env.RUNTIME_CONFIG_ENCRYPTION_KEY?.trim();
  if (!url || !rawKey) {
    throw new Error('DATABASE_URL and RUNTIME_CONFIG_ENCRYPTION_KEY are required; runtime.config is the only configuration source');
  }
  key = /^[\da-f]{64}$/i.test(rawKey) ? Buffer.from(rawKey, 'hex') : createHash('sha256').update(rawKey).digest();
  const connectionUrl = new URL(url);
  connectionUrl.searchParams.delete('schema'); // Prisma-specific option; node-postgres does not need it.
  pool = new Pool({ connectionString: connectionUrl.toString(), max: 5, connectionTimeoutMillis: 5000 });
  await pool.query('CREATE SCHEMA IF NOT EXISTS runtime');
  await pool.query('CREATE TABLE IF NOT EXISTS runtime.config (id text PRIMARY KEY, version integer NOT NULL, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('CREATE TABLE IF NOT EXISTS runtime.config_history (id text NOT NULL, version integer NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (id, version))');
  const existing = await pool.query('SELECT 1 FROM runtime.config WHERE id = $1', ['active']);
  if (existing.rowCount === 0) {
    // New installations start from the code-defined minimum seed, without credentials.
    const initial = validateSettings(settings());
    await pool.query('INSERT INTO runtime.config (id, version, payload) VALUES ($1, 1, $2) ON CONFLICT (id) DO NOTHING', ['active', JSON.stringify(encrypt(initial))]);
  }
  await pool.query('INSERT INTO runtime.config_history (id, version, payload) SELECT id, version, payload FROM runtime.config WHERE id = $1 ON CONFLICT DO NOTHING', ['active']);
  await reload();
  const poll = () => { void reload().catch((err: unknown) => console.error('runtime config reload failed', err)); };
  const timer = setInterval(poll, 3000);
  timer.unref();
}

function validateSettings(value: unknown): Settings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Settings must be an object');
  const v = value as Record<string, any>;
  if (!v.ai || typeof v.ai !== 'object' || Array.isArray(v.ai) || !v.ai.providers || typeof v.ai.providers !== 'object' || Array.isArray(v.ai.providers)) throw new Error('ai.providers is required');
  if (typeof v.ai.defaultModel !== 'string') throw new Error('ai.defaultModel is required');
  const providers = Object.entries(v.ai.providers) as [string, any][];
  for (const [name, provider] of providers) {
    if (!['openai', 'openrouter'].includes(name) || !provider || typeof provider.apiKey !== 'string' || !provider.apiKey.trim() || provider.apiKey === 'replace-me') throw new Error('Invalid provider: ' + name);
    if (!Array.isArray(provider.models) || provider.models.length === 0 || provider.models.some((m: unknown) => typeof m !== 'string' || !m.trim())) throw new Error('Invalid models for ' + name);
    if (provider.contextWindows !== undefined && (!provider.contextWindows || typeof provider.contextWindows !== 'object' || Array.isArray(provider.contextWindows) || Object.values(provider.contextWindows).some((n: any) => !Number.isInteger(n) || n < 1))) throw new Error('Invalid contextWindows for ' + name);
    provider.models = [...new Set(provider.models.map((model: string) => model.trim()))];
    provider.contextWindows ??= {};
  }
  if (!v.mcpConfig || typeof v.mcpConfig !== 'object' || Array.isArray(v.mcpConfig)) throw new Error('mcpConfig must be an object');
  for (const [name, mcp] of Object.entries(v.mcpConfig) as [string, any][]) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || !mcp || typeof mcp.url !== 'string') throw new Error('Invalid MCP: ' + name);
    const mcpUrl = new URL(mcp.url);
    if (!['http:', 'https:'].includes(mcpUrl.protocol) || mcpUrl.username || mcpUrl.password) throw new Error('Invalid MCP URL: ' + name);
    if (mcp.headers !== undefined && (!mcp.headers || typeof mcp.headers !== 'object' || Array.isArray(mcp.headers) || Object.values(mcp.headers).some((h) => typeof h !== 'string'))) throw new Error('Invalid MCP headers: ' + name);
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
  for (const field of ['contextTokenBudget', 'maxContextMessages', 'maxOutputTokens', 'reserveOutputTokens', 'contextSafetyTokens', 'maxToolSteps', 'summaryTokenBudget']) {
    if (!Number.isInteger(v[field]) || v[field] < 1) throw new Error(field + ' must be a positive integer');
  }
  if (v.reserveOutputTokens < v.maxOutputTokens) {
    throw new Error('reserveOutputTokens must be greater than or equal to maxOutputTokens');
  }
  if (typeof v.chatSystemPrompt !== 'string' || typeof v.llmTraceRequests !== 'boolean' || typeof v.summariesEnabled !== 'boolean') throw new Error('Invalid chat settings');
  if (providers.length === 0) {
    if (v.ai.defaultModel !== '') throw new Error('ai.defaultModel must be empty until a provider is configured');
  } else {
    const [provider, ...model] = v.ai.defaultModel.split('/');
    if (!v.ai.providers[provider]?.models.includes(model.join('/'))) throw new Error('The default model must be enabled');
  }
  return v as Settings;
}

/** Devuelve una instantánea aislada: los turnos no observan mutaciones a mitad de ejecución. */
export function getRuntimeSettings(): RuntimeSettings { return structuredClone(settings()); }
export function getRuntimeConfigVersion(): number { return version; }
export function isRuntimeConfigStoreEnabled(): boolean { return pool !== undefined && key !== undefined; }

export class RuntimeConfigConflictError extends Error {
  constructor() {
    super('Runtime config version conflict; reload the latest settings before saving');
    this.name = 'RuntimeConfigConflictError';
  }
}

export async function saveRuntimeSettings(value: unknown, expectedVersion?: number): Promise<number> {
  if (!pool) throw new Error('Database-backed config is disabled');
  const validated = validateSettings(value);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ version: number }>("SELECT version FROM runtime.config WHERE id = 'active' FOR UPDATE");
    const previousVersion = current.rows[0]?.version;
    if (previousVersion === undefined) throw new Error('Runtime config has not been initialized');
    if (expectedVersion !== undefined && expectedVersion !== previousVersion) throw new RuntimeConfigConflictError();
    const nextVersion = previousVersion + 1;
    const payload = JSON.stringify(encrypt(validated));
    await client.query("UPDATE runtime.config SET version = $1, payload = $2, updated_at = now() WHERE id = 'active'", [nextVersion, payload]);
    await client.query('INSERT INTO runtime.config_history (id, version, payload) VALUES ($1, $2, $3)', ['active', nextVersion, payload]);
    await client.query('COMMIT');
    Object.assign(config, validated);
    embeddingConfig = validated.embeddingConfig;
    version = nextVersion;
    return version;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
