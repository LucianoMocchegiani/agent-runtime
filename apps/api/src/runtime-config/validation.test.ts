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

test('valida catálogo de voz OpenAI y permite endpoint HTTP configurable', () => {
  const value = validSettings();
  const providers = (value.ai as { providers: Record<string, any> }).providers;
  providers.openai.voice = {
    baseUrl: ' http://voice.local:8080/v1/ ',
    transcriptionModels: [' transcribe ', 'transcribe'],
    speechModels: ['speech'],
    speechVoices: ['alloy'],
  };
  const normalized = validateRuntimeSettings(value);
  assert.deepEqual(normalized.ai.providers.openai?.voice, {
    baseUrl: 'http://voice.local:8080/v1',
    transcriptionModels: ['transcribe'], speechModels: ['speech'], speechVoices: ['alloy'],
  });

  providers.openai.voice.baseUrl = 'ftp://voice.local/v1';
  assert.throws(() => validateRuntimeSettings(value), /Invalid voice.baseUrl/);
});

test('rechaza proveedores no permitidos y URLs MCP con credenciales', () => {
  const unknownProvider = validSettings();
  (unknownProvider.ai as { providers: Record<string, unknown> }).providers.anthropic = { apiKey: 'secret', models: ['x'] };
  assert.throws(() => validateRuntimeSettings(unknownProvider), /Invalid provider/);

  const invalidUrl = validSettings();
  (invalidUrl.mcpConfig as Record<string, { url: string }>).local.url = 'https://user:pass@mcp.example.test';
  assert.throws(() => validateRuntimeSettings(invalidUrl), /Invalid MCP URL/);
});

test('normaliza autenticación por defecto y admite introspección HTTP', () => {
  const value = validSettings();
  const normalized = validateRuntimeSettings(value);
  assert.equal(normalized.authIntrospectUrl, null);
  assert.deepEqual(normalized.authMapping, { userId: 'userId', email: null, name: null });

  value.authIntrospectUrl = ' http://auth.example.test/me ';
  value.authMapping = { userId: ' sub ', email: null, name: ' displayName ' };
  const withAuth = validateRuntimeSettings(value);
  assert.equal(withAuth.authIntrospectUrl, 'http://auth.example.test/me');
  assert.deepEqual(withAuth.authMapping, { userId: 'sub', email: null, name: 'displayName' });
});

test('rechaza URL o mapeo de identidad inválidos', () => {
  const invalidProtocol = validSettings();
  invalidProtocol.authIntrospectUrl = 'ftp://auth.example.test/me';
  assert.throws(() => validateRuntimeSettings(invalidProtocol), /HTTP or HTTPS/);

  const invalidMapping = validSettings();
  invalidMapping.authMapping = { userId: '  ', email: null, name: null };
  assert.throws(() => validateRuntimeSettings(invalidMapping), /userId must be a non-empty/);
});

test('rechaza reservas de salida menores al máximo de respuesta', () => {
  const value = validSettings();
  value.reserveOutputTokens = 1;
  assert.throws(() => validateRuntimeSettings(value), /reserveOutputTokens must be greater than or equal/);
});
