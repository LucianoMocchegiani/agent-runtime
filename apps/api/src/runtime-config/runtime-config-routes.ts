import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../auth/contracts.js';
import { authorized } from './authorization.js';
import { AuthServiceError } from '../auth/service.js';
import { getRuntimeConfigVersion, getRuntimeSettings, isRuntimeConfigStoreEnabled, RuntimeConfigConflictError, saveRuntimeSettings } from './service.js';
import { RUNTIME_CONFIG_SECRET_MASK } from './constants.js';
/** Endpoints administrativos para leer y actualizar la configuración global del runtime. */
export const runtimeConfigRoutes = new Hono<AppEnv>();

function maskSecrets(settings: ReturnType<typeof getRuntimeSettings>) {
  const copy = structuredClone(settings);
  for (const provider of Object.values(copy.ai.providers)) if (provider) provider.apiKey = RUNTIME_CONFIG_SECRET_MASK;
  for (const mcp of Object.values(copy.mcpConfig)) {
    if (mcp.auth) mcp.auth = RUNTIME_CONFIG_SECRET_MASK;
    for (const name of Object.keys(mcp.headers)) mcp.headers[name] = RUNTIME_CONFIG_SECRET_MASK;
  }
  if (copy.embeddingConfig) copy.embeddingConfig.apiKey = RUNTIME_CONFIG_SECRET_MASK;
  return copy;
}
function restoreMaskedSecrets(next: any): void {
  const current = getRuntimeSettings();
  if (next?.embeddingConfig?.apiKey === RUNTIME_CONFIG_SECRET_MASK) next.embeddingConfig.apiKey = current.embeddingConfig?.apiKey;
  for (const [name, provider] of Object.entries(next?.ai?.providers ?? {}) as [string, any][]) {
    if (provider?.apiKey === RUNTIME_CONFIG_SECRET_MASK) provider.apiKey = current.ai.providers[name as keyof typeof current.ai.providers]?.apiKey;
  }
  for (const [name, mcp] of Object.entries(next?.mcpConfig ?? {}) as [string, any][]) {
    const previous = current.mcpConfig[name];
    if (!previous || !mcp || typeof mcp !== 'object') continue;
    if (mcp.auth === RUNTIME_CONFIG_SECRET_MASK) mcp.auth = previous.auth;
    if (mcp.headers && typeof mcp.headers === 'object') {
      for (const header of Object.keys(mcp.headers)) if (mcp.headers[header] === RUNTIME_CONFIG_SECRET_MASK) mcp.headers[header] = previous.headers[header];
    }
  }
}

runtimeConfigRoutes.use('*', async (c, next) => {
  if (!isRuntimeConfigStoreEnabled()) return c.json({ error: 'Not Found' }, 404);
  try {
    if (!(await authorized(c.req.header('Authorization')))) return c.json({ error: 'Not authorized to manage runtime configuration' }, 403);
  } catch (error) {
    if (error instanceof AuthServiceError) throw new HTTPException(error.status, { message: error.message });
    throw error;
  }
  await next();
});

runtimeConfigRoutes.get('/', (c) => c.json({ version: getRuntimeConfigVersion(), settings: maskSecrets(getRuntimeSettings()) }));
runtimeConfigRoutes.put('/', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  if (!body || typeof body !== 'object' || !('settings' in body)) return c.json({ error: 'Expected a settings object' }, 400);
  const request = body as { settings: unknown; version?: unknown };
  const candidate = request.settings;
  if (!candidate || typeof candidate !== 'object') return c.json({ error: 'Settings must be an object' }, 400);
  if (request.version !== undefined && (!Number.isSafeInteger(request.version) || (request.version as number) < 1)) {
    return c.json({ error: 'version must be a positive integer' }, 400);
  }
  restoreMaskedSecrets(candidate);
  try {
    const version = await saveRuntimeSettings(candidate, request.version as number | undefined);
    return c.json({ version, settings: maskSecrets(getRuntimeSettings()) });
  } catch (error) {
    if (error instanceof RuntimeConfigConflictError) return c.json({ error: error.message, version: getRuntimeConfigVersion() }, 409);
    return c.json({ error: error instanceof Error ? error.message : 'Invalid settings' }, 400);
  }
});

