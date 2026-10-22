import assert from 'node:assert/strict';
import test from 'node:test';
import type { MCPClient } from '@ai-sdk/mcp';
import type { McpConfig } from '../config.js';
import { McpRegistry } from './registry.js';

const config: McpConfig = {
  example: { url: 'http://localhost/mcp', auth: null, headers: {}, optional: false },
};

function fakeClient(overrides: Partial<MCPClient> = {}): MCPClient {
  return {
    serverInfo: { name: 'test', version: '1' },
    listTools: async () => ({ tools: [] }),
    toolsFromDefinitions: () => ({}),
    close: async () => undefined,
    ...overrides,
  } as unknown as MCPClient;
}

test('cancelar la inicialización MCP interrumpe connect', async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const registry = new McpRegistry(config, (clientConfig) => {
    receivedSignal = clientConfig.initializationOptions?.signal;
    return new Promise<MCPClient>((_resolve, reject) => {
      receivedSignal?.addEventListener('abort', () => reject(receivedSignal?.reason), { once: true });
    });
  });

  const connecting = registry.connect('token', undefined, controller.signal);
  controller.abort(new Error('test abort'));
  await assert.rejects(connecting, /test abort/);
  assert.equal(receivedSignal, controller.signal);
});

test('cancelar la consulta MCP de tools interrumpe getAllTools', async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const client = fakeClient({
    listTools: async ({ options } = {}) => {
      receivedSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        receivedSignal?.addEventListener('abort', () => reject(receivedSignal?.reason), { once: true });
      });
    },
  });
  const registry = new McpRegistry(config, async () => client);
  await registry.connect('token');

  const listing = registry.getAllTools(controller.signal);
  controller.abort(new Error('list aborted'));
  await assert.rejects(listing, /list aborted/);
  assert.equal(receivedSignal, controller.signal);
  await registry.close();
});

test('usa la conexión OAuth del MCP como Bearer y no filtra el token global', async () => {
  const oauthConfig: McpConfig = {
    secure: { url: 'https://mcp.example/mcp', auth: null, headers: {}, optional: false, oauth: { clientId: 'id', clientSecret: 'secret', scopes: [] } },
  };
  let headers: Record<string, string> | undefined;
  const registry = new McpRegistry(oauthConfig, (clientConfig) => {
    headers = (clientConfig.transport as { headers?: Record<string, string> }).headers;
    return Promise.resolve(fakeClient());
  });
  await registry.connect('runtime-service-token', { secure: 'user-oauth-token' });
  assert.equal(headers?.Authorization, 'Bearer user-oauth-token');
  await registry.close();
});

test('no conecta un MCP OAuth sin credencial de usuario', async () => {
  const oauthConfig: McpConfig = {
    secure: { url: 'https://mcp.example/mcp', auth: null, headers: {}, optional: false, oauth: { clientId: 'id', clientSecret: 'secret', scopes: [] } },
  };
  const registry = new McpRegistry(oauthConfig, async () => fakeClient());
  await assert.rejects(registry.connect('runtime-service-token'), /requires a user OAuth connection/);
});

test('close no espera indefinidamente a un cliente MCP', async () => {
  const client = fakeClient({ close: () => new Promise<void>(() => undefined) });
  const registry = new McpRegistry(config, async () => client);
  await registry.connect('token');

  const startedAt = Date.now();
  await registry.close();
  assert.ok(Date.now() - startedAt < 1_500);
  assert.equal(registry.size, 0);
});
