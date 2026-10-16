import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRuntimeSettings } from './validation.js';

function validSettings(): Record<string, unknown> {
  return {
    ai: { defaultModel: 'openai/gpt-test', providers: { openai: { apiKey: 'secret', models: ['gpt-test', ' gpt-test '], contextWindows: { 'gpt-test': 32_000 } } } },
    mcpConfig: { local: { url: 'https://mcp.example.test', headers: { Authorization: 'secret' } } },
    embeddingConfig: { apiKey: 'embedding-secret', baseUrl: 'https://embeddings.example.test/v1/', model: ' embed-v1 ' },
    chatSystemPrompt: 'system', contextTokenBudget: 10_000, maxContextMessages: 20,
    maxOutputTokens: 4_096, reserveOutputTokens: 4_096, contextSafetyTokens: 512,
    maxToolSteps: 8, llmTraceRequests: false, summariesEnabled: true, summaryTokenBudget: 300,
  };
}

test('valida, normaliza y no muta el objeto recibido', () => {
  const source = validSettings();
  const original = structuredClone(source);
  const result = validateRuntimeSettings(source);

  assert.deepEqual(source, original);
  assert.deepEqual(result.ai.providers.openai?.models, ['gpt-test']);
  assert.equal(result.embeddingConfig?.baseUrl, 'https://embeddings.example.test/v1');
  assert.equal(result.embeddingConfig?.model, 'embed-v1');
  assert.equal(result.mcpConfig.local?.auth, null);
  assert.equal(result.mcpConfig.local?.optional, false);
});

test('rechaza proveedores no permitidos y URLs MCP con credenciales', () => {
  const unknownProvider = validSettings();
  (unknownProvider.ai as { providers: Record<string, unknown> }).providers.anthropic = { apiKey: 'secret', models: ['x'] };
  assert.throws(() => validateRuntimeSettings(unknownProvider), /Invalid provider/);

  const invalidUrl = validSettings();
  (invalidUrl.mcpConfig as Record<string, { url: string }>).local.url = 'https://user:pass@mcp.example.test';
  assert.throws(() => validateRuntimeSettings(invalidUrl), /Invalid MCP URL/);
});

test('rechaza reservas de salida menores al máximo de respuesta', () => {
  const value = validSettings();
  value.reserveOutputTokens = 1;
  assert.throws(() => validateRuntimeSettings(value), /reserveOutputTokens must be greater than or equal/);
});
