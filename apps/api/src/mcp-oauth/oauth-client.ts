import type { McpOAuthConfig, McpServerConfig } from '../config.js';

export type OAuthMetadata = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post' | 'none';
  registrationEndpoint?: string;
  issuer: string;
  resource?: string;
};
type JsonObject = Record<string, unknown>;

function validEndpoint(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`OAuth metadata has no ${label}`);
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error(`OAuth ${label} must use HTTPS`);
  return url.toString();
}

async function getJson(url: string): Promise<JsonObject> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`OAuth metadata request failed (${response.status})`);
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid OAuth metadata');
  return body as JsonObject;
}

function metadataUrl(issuer: string, wellKnown: string): string {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/$/, '');
  url.pathname = path ? `/.well-known/${wellKnown}${path}` : `/.well-known/${wellKnown}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function openIdConfigurationUrl(issuer: string): string {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/$/, '');
  url.pathname = path ? `${path}/.well-known/openid-configuration` : '/.well-known/openid-configuration';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** Descubre Protected Resource Metadata MCP y Authorization Server Metadata (RFC 8414). */
export async function discoverOAuthMetadata(mcp: McpServerConfig): Promise<OAuthMetadata> {
  const target = new URL(mcp.url);
  const resourceCandidates = [
    new URL('/.well-known/oauth-protected-resource', target.origin).toString(),
    new URL(`/.well-known/oauth-protected-resource${target.pathname === '/' ? '' : target.pathname}`, target.origin).toString(),
  ];
  let protectedResource: JsonObject | null = null;
  for (const candidate of [...new Set(resourceCandidates)]) {
    try { protectedResource = await getJson(candidate); break; } catch { /* Try the MCP path-aware form. */ }
  }
  if (!protectedResource) throw new Error('MCP server did not publish OAuth Protected Resource Metadata');
  const authorizationServers = protectedResource.authorization_servers;
  if (!Array.isArray(authorizationServers) || typeof authorizationServers[0] !== 'string') {
    throw new Error('MCP server did not publish OAuth Protected Resource Metadata with authorization_servers');
  }
  const issuerUrl = new URL(authorizationServers[0]);
  if (issuerUrl.protocol !== 'https:' && issuerUrl.hostname !== 'localhost' && issuerUrl.hostname !== '127.0.0.1') throw new Error('OAuth issuer must use HTTPS');
  const issuer = issuerUrl.toString();
  let serverMetadata: JsonObject;
  try { serverMetadata = await getJson(metadataUrl(issuer, 'oauth-authorization-server')); }
  catch { serverMetadata = await getJson(openIdConfigurationUrl(issuer)); }
  const advertisedMethods = Array.isArray(serverMetadata.token_endpoint_auth_methods_supported)
    ? serverMetadata.token_endpoint_auth_methods_supported.filter((method): method is string => typeof method === 'string')
    : [];
  const tokenEndpointAuthMethod = mcp.oauth?.registration === 'dynamic'
    ? (advertisedMethods.length === 0 || advertisedMethods.includes('client_secret_basic') ? 'client_secret_basic'
      : advertisedMethods.includes('client_secret_post') ? 'client_secret_post' : 'none')
    : advertisedMethods.length === 0
      ? (mcp.oauth?.clientSecret ? 'client_secret_basic' : 'none')
      : !mcp.oauth?.clientSecret && advertisedMethods.includes('none') ? 'none'
        : mcp.oauth?.clientSecret && advertisedMethods.includes('client_secret_basic') ? 'client_secret_basic'
          : mcp.oauth?.clientSecret && advertisedMethods.includes('client_secret_post') ? 'client_secret_post' : null;
  if (tokenEndpointAuthMethod === null) {
    throw new Error('OAuth token endpoint has no supported authentication method for this client');
  }
  return {
    authorizationEndpoint: validEndpoint(serverMetadata.authorization_endpoint, 'authorization_endpoint'),
    tokenEndpoint: validEndpoint(serverMetadata.token_endpoint, 'token_endpoint'),
    tokenEndpointAuthMethod: tokenEndpointAuthMethod ?? 'none',
    ...(typeof serverMetadata.registration_endpoint === 'string' ? { registrationEndpoint: validEndpoint(serverMetadata.registration_endpoint, 'registration_endpoint') } : {}),
    issuer,
    ...(typeof protectedResource.resource === 'string' ? { resource: protectedResource.resource } : {}),
  };
}

export type RegisteredOAuthClient = { clientId: string; clientSecret?: string; tokenEndpointAuthMethod: OAuthMetadata['tokenEndpointAuthMethod']; expiresAt: Date | null };

/** Registra un cliente RFC 7591 para la URL de callback de Runtime. */
export async function registerDynamicOAuthClient(metadata: OAuthMetadata, redirectUri: string): Promise<RegisteredOAuthClient> {
  if (!metadata.registrationEndpoint) throw new Error('OAuth authorization server does not support Dynamic Client Registration');
  const response = await fetch(metadata.registrationEndpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'agent-runtime',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: metadata.tokenEndpointAuthMethod,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  let data: JsonObject;
  try {
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid JSON');
    data = parsed as JsonObject;
  } catch {
    throw new Error(`OAuth client registration returned invalid JSON (${response.status})`);
  }
  if (!response.ok || typeof data.client_id !== 'string' || !data.client_id.trim()) {
    const description = typeof data.error_description === 'string' ? data.error_description : typeof data.error === 'string' ? data.error : `HTTP ${response.status}`;
    throw new Error(`OAuth client registration failed: ${description}`);
  }
  const clientSecret = typeof data.client_secret === 'string' && data.client_secret ? data.client_secret : undefined;
  const expiresSeconds = data.client_secret_expires_at;
  const expiresAt = typeof expiresSeconds === 'number' && Number.isFinite(expiresSeconds) && expiresSeconds > 0
    ? new Date(expiresSeconds * 1000)
    : null;
  const registeredMethod = data.token_endpoint_auth_method;
  const tokenEndpointAuthMethod = registeredMethod === 'client_secret_basic' || registeredMethod === 'client_secret_post' || registeredMethod === 'none'
    ? registeredMethod : metadata.tokenEndpointAuthMethod;
  if (tokenEndpointAuthMethod !== 'none' && !clientSecret) {
    throw new Error('OAuth client registration requires a client_secret but did not return one');
  }
  return { clientId: data.client_id.trim(), ...(clientSecret ? { clientSecret } : {}), tokenEndpointAuthMethod, expiresAt };
}

export type OAuthTokenResponse = { access_token?: string; refresh_token?: string; token_type?: string; expires_in?: number; error?: string; error_description?: string };

function tokenExpiry(expiresIn: unknown): Date | null {
  return typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
}

async function postToken(endpoint: string, body: Record<string, string>, client: McpOAuthConfig, authMethod: OAuthMetadata['tokenEndpointAuthMethod']): Promise<OAuthTokenResponse> {
  if (!client.clientId) throw new Error('OAuth client_id is missing');
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
  const form = new URLSearchParams({ ...body, client_id: client.clientId });
  if (authMethod === 'client_secret_basic' && client.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`;
  } else if (authMethod === 'client_secret_post' && client.clientSecret) {
    form.set('client_secret', client.clientSecret);
  }
  const response = await fetch(endpoint, {
    method: 'POST', headers, body: form, signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json() as OAuthTokenResponse;
  if (!response.ok || !data.access_token) throw new Error(data.error_description ?? data.error ?? `OAuth token request failed (${response.status})`);
  return data;
}

export async function exchangeAuthorizationCode(metadata: OAuthMetadata, client: McpOAuthConfig, params: { code: string; redirectUri: string; verifier: string }) {
  const data = await postToken(metadata.tokenEndpoint, {
    grant_type: 'authorization_code', code: params.code, redirect_uri: params.redirectUri, code_verifier: params.verifier,
  }, client, metadata.tokenEndpointAuthMethod);
  return { accessToken: data.access_token!, refreshToken: data.refresh_token ?? null, tokenType: data.token_type ?? 'Bearer', expiresAt: tokenExpiry(data.expires_in) };
}

export async function refreshOAuthToken(metadata: OAuthMetadata, client: McpOAuthConfig, refreshToken: string) {
  const data = await postToken(metadata.tokenEndpoint, { grant_type: 'refresh_token', refresh_token: refreshToken }, client, metadata.tokenEndpointAuthMethod);
  return { accessToken: data.access_token!, refreshToken: data.refresh_token ?? refreshToken, tokenType: data.token_type ?? 'Bearer', expiresAt: tokenExpiry(data.expires_in) };
}
