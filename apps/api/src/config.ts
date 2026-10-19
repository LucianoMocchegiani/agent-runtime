/**
 * Env del servicio agent-runtime. Los perfiles persistidos definen el modelo y el comportamiento del agente;
 * runtime.config guarda configuración global de infraestructura y secretos. El huésped inyecta URLs de servicio y CORS.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Proveedores de modelos cuyo soporte está integrado en esta aplicación. */
export const AI_PROVIDERS = ['openrouter', 'openai'] as const;

/** Identificador de un proveedor de modelos soportado. */
export type AiProvider = (typeof AI_PROVIDERS)[number];

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

function parsePort(raw: string | undefined): number {
  if (!raw?.trim()) {
    return 3030;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
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

/** Mapeo de campos del servicio de introspección a la identidad interna. */
export type AuthMapping = {
  userId: string;
  email: string | null;
  name: string | null;
};

/** Configuración de conexión, autenticación y obligatoriedad de un servidor MCP. */
export type McpServerConfig = {
  url: string;
  auth: string | null;
  headers: Record<string, string>;
  /** Si no conecta, el turno sigue sin sus tools (default false: falla con 502). */
  optional: boolean;
};

/** Servidores MCP configurados, indexados por nombre lógico. */
export type McpConfig = Record<string, McpServerConfig>;

/** Clave y catálogo de modelos/contextos de un proveedor de IA. */
export type AiProviderVoiceConfig = {
  /** URL base OpenAI-compatible usada para Realtime y audio/speech. */
  baseUrl: string;
  transcriptionModels: string[];
  speechModels: string[];
  speechVoices: string[];
};

export type AiProviderConfig = {
  apiKey: string;
  /** Modelos ofrecidos en el selector (ids del proveedor, sin prefijo). */
  models: string[];
  /** Ventanas explícitas en tokens, indexadas por id del modelo del proveedor. */
  contextWindows: Record<string, number>;
  /** Catálogo opcional de capacidades de voz. Actualmente solo se implementa para OpenAI. */
  voice?: AiProviderVoiceConfig;
};

/** Proveedores habilitados y modelo seleccionado como valor de compatibilidad. */
export type AiConfig = {
  /** Id completo `proveedor/modelo`; vacío hasta configurar el primer proveedor. */
  defaultModel: string;
  /** Solo proveedores habilitados (con apiKey real). */
  providers: Partial<Record<AiProvider, AiProviderConfig>>;
};

/** Configuración inicial del servicio, completada después desde el almacén runtime. */
export type ChatConfig = {
  port: number;
  mcpConfig: McpConfig;
  /** Null deshabilita la introspección y deja las rutas en modo público/anónimo. */
  authIntrospectUrl: string | null;
  authMapping: AuthMapping;
  ai: AiConfig;
  corsOrigins: string[];
  corsAppDomain: string | null;
  /** Valores bootstrap/compatibilidad: se migran al perfil inicial, no se editan como configuración global. */
  chatSystemPrompt: string;
  contextTokenBudget: number;
  maxContextMessages: number;
  maxOutputTokens: number;
  reserveOutputTokens: number;
  contextSafetyTokens: number;
  maxToolSteps: number;
  llmTraceRequests: boolean;
  summariesEnabled: boolean;
  summaryTokenBudget: number;
  ui: {
    enabled: boolean;
    /** Absoluta; null si no hay build. */
    dir: string | null;
  };
};

/** Semilla mínima usada solo cuando todavía no existe `runtime.config`. */
/** Configuración inicial leída del entorno; se completa con valores persistidos al arrancar. */
export const config: ChatConfig = {
  port: parsePort(process.env.PORT),
  mcpConfig: {},
  authIntrospectUrl: null,
  authMapping: { userId: 'userId', email: null, name: null },
  ai: { defaultModel: '', providers: {} },
  corsOrigins: parseOrigins(process.env.CORS_ORIGIN),
  corsAppDomain: process.env.CORS_APP_DOMAIN?.trim().toLowerCase() || null,
  chatSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  contextTokenBudget: 10_000,
  maxContextMessages: 20,
  maxOutputTokens: 4_096,
  reserveOutputTokens: 4_096,
  contextSafetyTokens: 512,
  maxToolSteps: 8,
  llmTraceRequests: false,
  summariesEnabled: true,
  summaryTokenBudget: 300,
  ui: {
    enabled: parseBool(process.env.UI_ENABLED, true),
    dir: resolveUiDir(process.env.UI_DIR),
  },
};
