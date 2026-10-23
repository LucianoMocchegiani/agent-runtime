import { createHash, randomBytes } from 'node:crypto';
import { assertOAuthEncryptionConfigured } from './crypto.js';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../auth/contracts.js';
import { getRuntimeSettings } from '../runtime-config/service.js';
import { createOAuthState, consumeOAuthState, deleteMcpOAuthConnection, getMcpOAuthConnection, saveMcpOAuthConnection } from './persistence.js';
import { discoverOAuthMetadata, exchangeAuthorizationCode } from './oauth-client.js';
import { resolveOAuthClient } from './client-registration.js';

const CALLBACK_PATH = '/oauth/mcp/callback';
const MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function callbackUri(): string {
  const raw = process.env.MCP_OAUTH_REDIRECT_URI?.trim();
  if (!raw) throw new HTTPException(503, { message: 'MCP_OAUTH_REDIRECT_URI no está configurada.' });
  let callback: URL;
  try { callback = new URL(raw); } catch { throw new HTTPException(503, { message: 'MCP_OAUTH_REDIRECT_URI no es una URL válida.' }); }
  if (callback.pathname !== CALLBACK_PATH || callback.username || callback.password || (callback.protocol !== 'https:' && callback.hostname !== 'localhost' && callback.hostname !== '127.0.0.1')) {
    throw new HTTPException(503, { message: `MCP_OAUTH_REDIRECT_URI debe ser HTTPS y terminar en ${CALLBACK_PATH}.` });
  }
  return callback.toString();
}

function uiRedirect(status: 'connected' | 'error', mcpName: string, callbackUrl?: string): URL {
  const configured = process.env.MCP_OAUTH_UI_REDIRECT_URL?.trim();
  const base = configured ? new URL(configured) : new URL('/', callbackUrl ?? 'http://localhost');
  base.searchParams.set('mcp-oauth', mcpName);
  base.searchParams.set('status', status);
  return base;
}

function getOAuthMcp(name: string) {
  const settings = getRuntimeSettings();
  const mcp = settings.mcpConfig[name];
  if (!mcp?.oauth) throw new HTTPException(404, { message: 'El servidor MCP no tiene OAuth configurado en Runtime.' });
  return { settings, mcp };
}

export const mcpConnectionRoutes = new Hono<AppEnv>();
mcpConnectionRoutes.get('/', async (c) => {
  const userId = c.get('principal').userId;
  const configured = Object.entries(getRuntimeSettings().mcpConfig).filter(([, mcp]) => Boolean(mcp.oauth));
  const items = await Promise.all(configured.map(async ([name]) => {
    const connection = await getMcpOAuthConnection(userId, name);
    return { name, connected: Boolean(connection), account: connection?.account ?? null, expiresAt: connection?.expiresAt?.toISOString() ?? null };
  }));
  return c.json({ items });
});

mcpConnectionRoutes.post('/:name/authorize', async (c) => {
  const name = c.req.param('name');
  if (!MCP_NAME_PATTERN.test(name)) throw new HTTPException(400, { message: 'Nombre de MCP inválido.' });
  const { mcp } = getOAuthMcp(name);
  const redirectUri = callbackUri();
  try { assertOAuthEncryptionConfigured(); } catch { throw new HTTPException(503, { message: 'MCP_OAUTH_ENCRYPTION_KEY no está configurada correctamente.' }); }
  const discovered = await discoverOAuthMetadata(mcp);
  const { metadata, client } = await resolveOAuthClient(name, mcp, discovered, redirectUri);
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  await createOAuthState(state, c.get('principal').userId, name, verifier);

  const authorizationUrl = new URL(metadata.authorizationEndpoint);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', client.clientId!);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('code_challenge', challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  if (client.scopes.length) authorizationUrl.searchParams.set('scope', client.scopes.join(' '));
  if (metadata.resource) authorizationUrl.searchParams.set('resource', metadata.resource);
  return c.json({ authorizationUrl: authorizationUrl.toString() }, 201);
});

mcpConnectionRoutes.delete('/:name', async (c) => {
  const name = c.req.param('name');
  if (!MCP_NAME_PATTERN.test(name)) throw new HTTPException(400, { message: 'Nombre de MCP inválido.' });
  await deleteMcpOAuthConnection(c.get('principal').userId, name);
  return c.body(null, 204);
});

/** Callback OAuth público; el state de un solo uso asocia principal y MCP configurado. */
export const mcpOAuthCallbackRoutes = new Hono();
mcpOAuthCallbackRoutes.get('/mcp/callback', async (c) => {
  const callbackUrl = process.env.MCP_OAUTH_REDIRECT_URI?.trim();
  const state = c.req.query('state');
  const code = c.req.query('code');
  const oauthError = c.req.query('error');
  const codeLength = code?.length ?? 0;

  if (!state || state.length > 256) return c.redirect(uiRedirect('error', 'mcp', callbackUrl).toString(), 302);
  const savedState = await consumeOAuthState(state);
  if (!savedState) return c.redirect(uiRedirect('error', 'mcp', callbackUrl).toString(), 302);

  try {
    if (oauthError) throw new Error('MCP OAuth authorization was denied');
    if (!code || codeLength > 8192) throw new Error('Missing authorization code');
    const { mcp } = getOAuthMcp(savedState.mcpName);
    const redirectUri = callbackUri();
    const discovered = await discoverOAuthMetadata(mcp);
    const { metadata, client } = await resolveOAuthClient(savedState.mcpName, mcp, discovered, redirectUri);
    const tokens = await exchangeAuthorizationCode(metadata, client, { code, redirectUri, verifier: savedState.codeVerifier });
    await saveMcpOAuthConnection({ userId: savedState.userId, mcpName: savedState.mcpName, account: null, tokens });
    return c.redirect(uiRedirect('connected', savedState.mcpName, callbackUrl).toString(), 302);
  } catch (error) {
    console.error(`MCP OAuth callback failed for ${savedState.mcpName}:`, error instanceof Error ? error.message : 'unknown error');
    return c.redirect(uiRedirect('error', savedState.mcpName, callbackUrl).toString(), 302);
  }
});
