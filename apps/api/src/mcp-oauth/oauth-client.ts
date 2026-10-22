import type { McpOAuthConfig, McpServerConfig } from '../config.js';

export type OAuthMetadata = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post' | 'none';
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
  const issuer = new URL(authorizationServers[0]);
  if (issuer.protocol !== 'https:' && issuer.hostname !== 'localhost' && issuer.hostname !== '127.0.0.1') throw new Error('OAuth issuer must use HTTPS');
  let serverMetadata: JsonObject;
  try { serverMetadata = await getJson(metadataUrl(issuer.toString(), 'oauth-authorization-server')); }
  catch { serverMetadata = await getJson(openIdConfigurationUrl(issuer.toString())); }
  const advertisedMethods = Array.isArray(serverMetadata.token_endpoint_auth_methods_supported)
    ? serverMetadata.token_endpoint_auth_methods_supported.filter((method): method is string => typeof method === 'string')
    : [];
  const tokenEndpointAuthMethod = advertisedMethods.length === 0
    ? (mcp.oauth?.clientSecret ? 'client_secret_basic' : 'none')
    : !mcp.oauth?.clientSecret && advertisedMethods.includes('none') ? 'none'
      : mcp.oauth?.clientSecret && advertisedMethods.includes('client_secret_basic') ? 'client_secret_basic'
        : mcp.oauth?.clientSecret && advertisedMethods.includes('client_secret_post') ? 'client_secret_post' : null;
  if (tokenEndpointAuthMethod === null) throw new Error('OAuth token endpoint has no supported authentication method for this client');
  return {
    authorizationEndpoint: validEndpoint(serverMetadata.authorization_endpoint, 'authorization_endpoint'),
    tokenEndpoint: validEndpoint(serverMetadata.token_endpoint, 'token_endpoint'),
    tokenEndpointAuthMethod,
    ...(typeof protectedResource.resource === 'string' ? { resource: protectedResource.resource } : {}),
  };
}

export type OAuthTokenResponse = { access_token?: string; refresh_token?: string; token_type?: string; expires_in?: number; error?: string; error_description?: string };

function tokenExpiry(expiresIn: unknown): Date | null {
  return typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
}

async function postToken(endpoint: string, body: Record<string, string>, client: McpOAuthConfig, authMethod: OAuthMetadata['tokenEndpointAuthMethod']): Promise<OAuthTokenResponse> {
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
