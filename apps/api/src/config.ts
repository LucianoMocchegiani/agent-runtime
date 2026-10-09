/**
 * Env del servicio agent-runtime (portable). Si falta un required, el proceso no arranca.
 *
 * @remarks Cero `GYMBRO_*`. El huésped inyecta URLs (introspect, MCP, CORS).
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

export const AI_PROVIDERS = ['openrouter', 'openai'] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  openrouter: 'openai/gpt-4.1-mini',
  openai: 'gpt-4.1-mini',
};

function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Id de modelo estilo opencode: `proveedor/modelo`. Corta en la primera `/`
 * (`openrouter/openai/gpt-4.1-mini` → `openrouter` + `openai/gpt-4.1-mini`).
 */
export function splitModelId(id: string): { provider: string; model: string } | null {
  const slash = id.indexOf('/');
  if (slash <= 0 || slash === id.length - 1) {
    return null;
  }
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

function parseModelList(raw: unknown, provider: AiProvider): string[] {
  if (raw === undefined) {
    return [DEFAULT_AI_MODELS[provider]];
  }
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`AI_CONFIG.providers.${provider}.models must be an array of model ids`);
  }
  const models = [...new Set(raw.map((item: string) => item.trim()))];
  return models.length > 0 ? models : [DEFAULT_AI_MODELS[provider]];
}

/**
 * `AI_CONFIG={"default":"openrouter/openai/gpt-4.1-mini","providers":{"openrouter":{"apiKey":"...","models":[...],"contextWindows":{"openai/gpt-4.1-mini":128000}},"openai":{...}}}`.
 *
 * @remarks Proveedor sin `apiKey` o con `replace-me` queda deshabilitado; solo falla el boot si el default no es usable.
 * Los errores no incluyen el valor crudo: lleva API keys.
 */
function parseAiConfig(raw: string | undefined): AiConfig {
  if (!raw?.trim()) {
    throw new Error('Missing required env AI_CONFIG');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AI_CONFIG is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('AI_CONFIG must be a JSON object');
  }
  const root = parsed as Record<string, unknown>;
  const rawProviders = root.providers;
  if (typeof rawProviders !== 'object' || rawProviders === null || Array.isArray(rawProviders)) {
    throw new Error('AI_CONFIG.providers must be an object');
  }

  const providers: Partial<Record<AiProvider, AiProviderConfig>> = {};
  for (const [name, value] of Object.entries(rawProviders as Record<string, unknown>)) {
    if (!isAiProvider(name)) {
      throw new Error(`AI_CONFIG.providers.${name} is not supported. Use: ${AI_PROVIDERS.join(', ')}`);
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`AI_CONFIG.providers.${name} must be an object`);
    }
    const entry = value as Record<string, unknown>;
    const apiKey = typeof entry.apiKey === 'string' ? entry.apiKey.trim() : '';
    const models = parseModelList(entry.models, name);
    const rawContextWindows = entry.contextWindows;
    const contextWindows: Record<string, number> = {};
    if (rawContextWindows !== undefined) {
      if (
        typeof rawContextWindows !== 'object' ||
        rawContextWindows === null ||
        Array.isArray(rawContextWindows)
      ) {
        throw new Error(`AI_CONFIG.providers.${name}.contextWindows must be an object`);
      }
      for (const [model, tokens] of Object.entries(rawContextWindows as Record<string, unknown>)) {
        if (!model.trim() || typeof tokens !== 'number' || !Number.isInteger(tokens) || tokens < 1) {
          throw new Error(`AI_CONFIG.providers.${name}.contextWindows values must be positive integers`);
        }
        contextWindows[model] = tokens;
      }
    }
    if (!apiKey || apiKey === 'replace-me') {
      continue;
    }
    providers[name] = { apiKey, models, contextWindows };
  }

  const enabled = AI_PROVIDERS.filter((name) => providers[name]);
  if (enabled.length === 0) {
    throw new Error(
      'AI_CONFIG has no provider with a real apiKey. Recreate the container after editing agent-runtime/.env (restart does not reload env_file).',
    );
  }

  const rawDefault = typeof root.default === 'string' ? root.default.trim() : '';
  const defaultModel = rawDefault || `${enabled[0]}/${providers[enabled[0]]!.models[0]}`;
  const split = splitModelId(defaultModel);
  if (!split || !isAiProvider(split.provider)) {
    throw new Error('AI_CONFIG.default must be "provider/model"');
  }
  const defaultProvider = providers[split.provider];
  if (!defaultProvider) {
    throw new Error(`AI_CONFIG.default uses ${split.provider}, which has no real apiKey`);
  }
  if (!defaultProvider.models.includes(split.model)) {
    defaultProvider.models.unshift(split.model);
  }

  return { defaultModel, providers };
}

function parsePort(raw: string | undefined): number {
  if (!raw?.trim()) {
    return 3010;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid integer env: ${raw}`);
  }
  return value;
}

function parseOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error('CORS_ORIGIN must list at least one origin');
  }
  return origins;
}

/**
 * `MCP_CONFIG={"pc":{"url":"...","auth":null,"headers":{"Authorization":"Bearer ..."},"optional":true}}`.
 *
 * @remarks `headers` son fijos del servidor (secretos que nunca pasan por el navegador). Si `auth`
 * está seteado, su `Authorization` pisa al de `headers`. Los errores no incluyen valores: llevan secretos.
 */
function parseMcpConfig(raw: string | undefined): McpConfig {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('MCP_CONFIG is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('MCP_CONFIG must be a JSON object');
  }
  const result: McpConfig = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(`MCP_CONFIG name "${name}" must match [a-zA-Z0-9_-]`);
    }
    const entry = (value ?? {}) as Partial<McpServerConfig>;
    if (typeof entry.url !== 'string' || !entry.url.trim()) {
      throw new Error(`MCP_CONFIG ${name} missing url`);
    }
    const headers = entry.headers ?? {};
    if (
      typeof headers !== 'object' ||
      Array.isArray(headers) ||
      Object.values(headers).some((item) => typeof item !== 'string')
    ) {
      throw new Error(`MCP_CONFIG ${name}.headers must be an object of strings`);
    }
    result[name] = {
      url: entry.url.trim(),
      auth: entry.auth ?? null,
      headers,
      optional: entry.optional === true,
    };
  }
  return result;
}

function parseAuthMapping(raw: string | undefined): AuthMapping {
  if (!raw?.trim()) {
    return { userId: 'userId', email: null, name: null };
  }
  const parsed = JSON.parse(raw) as Record<string, string>;
  return {
    userId: parsed.userId ?? 'userId',
    email: parsed.email ?? null,
    name: parsed.name ?? null,
  };
}

function parseMcpUrls(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Carpeta con el build de la UI (`index.html`). Default `apps/ui/dist`, relativo a este módulo
 * (sirve igual desde `src/` con tsx y desde `dist/` compilado, local o en la imagen).
 *
 * @returns null si no hay build (la API sigue andando; en dev la UI corre en Vite).
 */
function resolveUiDir(raw: string | undefined): string | null {
  const dir = raw?.trim()
    ? resolve(raw.trim())
    : fileURLToPath(new URL('../../ui/dist', import.meta.url));
  return existsSync(join(dir, 'index.html')) ? dir : null;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw?.trim()) {
    return fallback;
  }
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1') {
    return true;
  }
  if (value === 'false' || value === '0') {
    return false;
  }
  throw new Error(`Invalid boolean env: ${raw}`);
}

const DEFAULT_SYSTEM_PROMPT =
  'Sos un asistente de IA. Usá las tools disponibles para responder. Si no sabés, decilo.';

export type AuthMapping = {
  userId: string;
  email: string | null;
  name: string | null;
};

export type McpServerConfig = {
  url: string;
  auth: string | null;
  headers: Record<string, string>;
  /** Si no conecta, el turno sigue sin sus tools (default false: falla con 502). */
  optional: boolean;
};

export type McpConfig = Record<string, McpServerConfig>;

export type AiProviderConfig = {
  apiKey: string;
  /** Modelos ofrecidos en el selector (ids del proveedor, sin prefijo). */
  models: string[];
  /** Ventanas explícitas en tokens, indexadas por id del modelo del proveedor. */
  contextWindows: Record<string, number>;
};

export type AiConfig = {
  /** Id completo `proveedor/modelo`. */
  defaultModel: string;
  /** Solo proveedores habilitados (con apiKey real). */
  providers: Partial<Record<AiProvider, AiProviderConfig>>;
};

export type ChatConfig = {
  port: number;
  mcpUrls: string[];
  mcpConfig: McpConfig;
  memoryMcpUrl: string;
  authIntrospectUrl: string;
  authMapping: AuthMapping;
  ai: AiConfig;
  corsOrigins: string[];
  corsAppDomain: string | null;
  chatSystemPrompt: string;
  /** Ventana total por defecto y compatibilidad para modelos sin contextoWindows configurado. */
  contextTokenBudget: number;
  /** Máximo de mensajes conversacionales enviados, sin contar system/tools disponibles. */
  maxContextMessages: number;
  responseTokenReserve: number;
  contextSafetyTokens: number;
  maxToolSteps: number;
  /** Emite en logs el contexto y las herramientas enviados al proveedor; puede contener datos sensibles. */
  llmTraceRequests: boolean;
  /** Resume y persiste turnos que quedaron fuera de la ventana de contexto. */
  summariesEnabled: boolean;
  summaryTokenBudget: number;
  ui: {
    enabled: boolean;
    /** Absoluta; null si no hay build. */
    dir: string | null;
  };
};

export const config: ChatConfig = {
  port: parsePort(process.env.PORT),
  mcpUrls: parseMcpUrls(process.env.MCP_URLS),
  mcpConfig: parseMcpConfig(process.env.MCP_CONFIG),
  memoryMcpUrl: required('MEMORY_MCP_URL'),
  authIntrospectUrl: required('AUTH_INTROSPECT_URL'),
  authMapping: parseAuthMapping(process.env.AUTH_MAPPING),
  ai: parseAiConfig(process.env.AI_CONFIG),
  corsOrigins: parseOrigins(required('CORS_ORIGIN')),
  corsAppDomain: process.env.CORS_APP_DOMAIN?.trim().toLowerCase() || null,
  chatSystemPrompt: process.env.CHAT_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT,
  contextTokenBudget: parsePositiveInt(process.env.CHAT_CONTEXT_TOKENS, 10_000),
  maxContextMessages: parsePositiveInt(process.env.CHAT_CONTEXT_MESSAGES, 20),
  responseTokenReserve: parsePositiveInt(process.env.CHAT_RESPONSE_TOKENS, 2_048),
  contextSafetyTokens: parsePositiveInt(process.env.CHAT_CONTEXT_SAFETY_TOKENS, 512),
  maxToolSteps: parsePositiveInt(process.env.CHAT_MAX_TOOL_STEPS, 8),
  llmTraceRequests: parseBool(process.env.LLM_TRACE_REQUESTS, false),
  summariesEnabled: parseBool(process.env.CHAT_SUMMARIES_ENABLED, true),
  summaryTokenBudget: parsePositiveInt(process.env.CHAT_SUMMARY_TOKENS, 300),
  ui: {
    enabled: parseBool(process.env.UI_ENABLED, true),
    dir: resolveUiDir(process.env.UI_DIR),
  },
};