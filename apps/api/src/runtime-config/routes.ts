import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { resolvePrincipal } from '../auth/introspect.js';
import type { AppEnv } from '../auth/principal.js';
import { getRuntimeConfigVersion, getRuntimeSettings, isRuntimeConfigStoreEnabled, RuntimeConfigConflictError, saveRuntimeSettings } from './store.js';

const MASK = '********';
export const runtimeConfigRoutes = new Hono<AppEnv>();

function matchesSecret(actualValue: string, expectedValue: string | undefined): boolean {
  if (!expectedValue) return false;
  const actual = Buffer.from(actualValue);
  const expected = Buffer.from(expectedValue);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function authorized(header: string | undefined): Promise<boolean> {
  const value = header?.trim() ?? '';
  const configuredAdmins = (process.env.RUNTIME_CONFIG_ADMIN_USERS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  // Bootstrap credentials are enabled only until an admin identity is configured.
  // Credentials are never accepted alongside a non-empty allowlist.
  if (configuredAdmins.length === 0) {
    const basic = /^Basic\s+([A-Za-z0-9+/]+=*)$/i.exec(value);
    if (basic) {
      let decoded: string;
      try { decoded = Buffer.from(basic[1], 'base64').toString('utf8'); } catch { return false; }
      const separator = decoded.indexOf(':');
      if (separator < 0) return false;
      const username = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      const expectedUsername = process.env.RUNTIME_CONFIG_BOOTSTRAP_USER?.trim() || 'admin';
      const expectedPassword = process.env.RUNTIME_CONFIG_BOOTSTRAP_PASSWORD ?? 'admin';
      return matchesSecret(username, expectedUsername) && matchesSecret(password, expectedPassword);
    }
  }

  const match = /^Bearer\s+(\S+)$/i.exec(value);
  if (!match) return false;
  const token = match[1];

  // Keep the server-side admin token for automation/CLI, but never provide it to the UI.
  if (matchesSecret(token, process.env.RUNTIME_CONFIG_ADMIN_TOKEN?.trim())) return true;

  // Browser access is granted only to authenticated identities explicitly allowlisted by an operator.
  // Anonymous session ids used by the chat UI are deliberately not accepted here.
  if (token.startsWith('anon:') || configuredAdmins.length === 0) return false;

  const principal = await resolvePrincipal(token);
  return configuredAdmins.some((identity) =>
    principal.userId === identity || principal.email?.toLowerCase() === identity.toLowerCase(),
  );
}
function maskSecrets(settings: ReturnType<typeof getRuntimeSettings>) {
  const copy = structuredClone(settings);
  for (const provider of Object.values(copy.ai.providers)) if (provider) provider.apiKey = MASK;
  for (const mcp of Object.values(copy.mcpConfig)) {
    if (mcp.auth) mcp.auth = MASK;
    for (const name of Object.keys(mcp.headers)) mcp.headers[name] = MASK;
  }
  if (copy.embeddingConfig) copy.embeddingConfig.apiKey = MASK;
  return copy;
}
function restoreMaskedSecrets(next: any): void {
  const current = getRuntimeSettings();
  if (next?.embeddingConfig?.apiKey === MASK) next.embeddingConfig.apiKey = current.embeddingConfig?.apiKey;
  for (const [name, provider] of Object.entries(next?.ai?.providers ?? {}) as [string, any][]) {
    if (provider?.apiKey === MASK) provider.apiKey = current.ai.providers[name as keyof typeof current.ai.providers]?.apiKey;
  }
  for (const [name, mcp] of Object.entries(next?.mcpConfig ?? {}) as [string, any][]) {
    const previous = current.mcpConfig[name];
    if (!previous || !mcp || typeof mcp !== 'object') continue;
    if (mcp.auth === MASK) mcp.auth = previous.auth;
    if (mcp.headers && typeof mcp.headers === 'object') {
      for (const header of Object.keys(mcp.headers)) if (mcp.headers[header] === MASK) mcp.headers[header] = previous.headers[header];
    }
  }
}

runtimeConfigRoutes.use('*', async (c, next) => {
  if (!isRuntimeConfigStoreEnabled()) return c.json({ error: 'Not Found' }, 404);
  if (!(await authorized(c.req.header('Authorization')))) return c.json({ error: 'Not authorized to manage runtime configuration' }, 403);
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

