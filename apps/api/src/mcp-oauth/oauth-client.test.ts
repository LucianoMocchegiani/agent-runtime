import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServerConfig } from '../config.js';
import { discoverOAuthMetadata, exchangeAuthorizationCode, registerDynamicOAuthClient, type OAuthMetadata } from './oauth-client.js';

const mcp: McpServerConfig = {
  url: 'https://mcp.example.test/mcp', auth: null, headers: {}, optional: false,
  oauth: { clientId: 'client-id', clientSecret: 'client-secret', scopes: ['tools:read'] },
};

test('discovers the configured MCP authorization server metadata and exchanges PKCE code', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://mcp.example.test/.well-known/oauth-protected-resource') {
      return Response.json({ resource: 'https://mcp.example.test/mcp', authorization_servers: ['https://auth.example.test/tenant'] });
    }
    if (url === 'https://auth.example.test/.well-known/oauth-authorization-server/tenant') {
      return Response.json({
        authorization_endpoint: 'https://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token',
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      });
    }
    if (url === 'https://auth.example.test/token') return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    const metadata = await discoverOAuthMetadata(mcp);
    assert.equal(metadata.authorizationEndpoint, 'https://auth.example.test/authorize');
    assert.equal(metadata.resource, 'https://mcp.example.test/mcp');
    assert.equal(metadata.issuer, 'https://auth.example.test/tenant');
    const tokens = await exchangeAuthorizationCode(metadata, mcp.oauth!, { code: 'code', redirectUri: 'https://runtime.example.test/oauth/mcp/callback', verifier: 'verifier' });
    assert.equal(tokens.accessToken, 'access');
    assert.equal(tokens.refreshToken, 'refresh');
    assert.equal(calls.length, 3);
    assert.equal(new Headers(calls[2].init?.headers).get('authorization'), `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);
    assert.match(String(calls[2].init?.body), /code_verifier=verifier/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('registers a dynamic confidential client with the runtime callback', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      client_id: 'registered-id', client_secret: 'registered-secret',
      token_endpoint_auth_method: 'client_secret_basic', client_secret_expires_at: 0,
    }, { status: 201 });
  }) as typeof fetch;
  const metadata: OAuthMetadata = {
    issuer: 'https://auth.example.test', authorizationEndpoint: 'https://auth.example.test/authorize',
    tokenEndpoint: 'https://auth.example.test/token', registrationEndpoint: 'https://auth.example.test/register',
    tokenEndpointAuthMethod: 'client_secret_basic',
  };
  try {
    const client = await registerDynamicOAuthClient(metadata, 'https://runtime.example.test/oauth/mcp/callback');
    assert.equal(client.clientId, 'registered-id');
    assert.equal(client.clientSecret, 'registered-secret');
    assert.equal(client.tokenEndpointAuthMethod, 'client_secret_basic');
    assert.equal(client.expiresAt, null);
    assert.deepEqual(sentBody?.redirect_uris, ['https://runtime.example.test/oauth/mcp/callback']);
    assert.deepEqual(sentBody?.grant_types, ['authorization_code', 'refresh_token']);
    assert.deepEqual(sentBody?.response_types, ['code']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
