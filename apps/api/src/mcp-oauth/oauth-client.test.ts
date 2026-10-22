import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServerConfig } from '../config.js';
import { discoverOAuthMetadata, exchangeAuthorizationCode } from './oauth-client.js';

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
