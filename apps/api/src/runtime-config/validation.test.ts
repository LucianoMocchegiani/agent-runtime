import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRuntimeSettings } from './validation.js';

function validSettings(): Record<string, any> {
  return {
    ai: { providers: { openai: {
      apiKey: 'secret', baseUrl: 'https://api.openai.com/v1/',
      models: { chat: ['gpt-test', ' gpt-test '], embeddings: ['text-embedding-3-small'], realtime: ['gpt-realtime'] },
      realtime: { voices: ['alloy', 'alloy'] },
    } } },
    mcpConfig: { local: { url: 'https://mcp.example.test', headers: { Authorization: 'secret' } } },
    embeddingConfig: { model: ' openai/text-embedding-3-small ' },
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
  assert.deepEqual(result.ai.providers.openai?.models, { chat: ['gpt-test'], embeddings: ['text-embedding-3-small'], realtime: ['gpt-realtime'] });
  assert.deepEqual(result.ai.providers.openai?.realtime, { voices: ['alloy'] });
  assert.equal(result.ai.providers.openai?.baseUrl, 'https://api.openai.com/v1');
  assert.deepEqual(result.embeddingConfig, { model: 'openai/text-embedding-3-small' });
  assert.equal(result.mcpConfig.local?.auth, null);
  assert.equal(result.mcpConfig.local?.optional, false);
});

test('la configuración AI normalizada contiene únicamente proveedores', () => {
  const value = validSettings();
  value.ai.unusedSetting = 'ignored';
  const normalized = validateRuntimeSettings(value);
  assert.deepEqual(Object.keys(normalized.ai), ['providers']);
});

test('rechaza el formato anterior del proveedor en lugar de migrarlo', () => {
  const oldVoiceFormat = validSettings();
  oldVoiceFormat.ai.providers.openai = {
    apiKey: 'secret', models: ['gpt-test'],
    voice: { baseUrl: 'http://voice.local/v1', realtimeModels: ['gpt-realtime'], speechVoices: ['alloy'] },
  };
  assert.throws(() => validateRuntimeSettings(oldVoiceFormat), /provider.voice is no longer supported/);

  const oldChatModelsFormat = validSettings();
  oldChatModelsFormat.ai.providers.openai.models = ['gpt-test'];
  assert.throws(() => validateRuntimeSettings(oldChatModelsFormat), /Invalid models/);

  const legacyContextWindows = validSettings();
  legacyContextWindows.ai.providers.openai.contextWindows = { 'gpt-test': 32_000 };
  const normalized = validateRuntimeSettings(legacyContextWindows);
  assert.deepEqual(legacyContextWindows.ai.providers.openai.contextWindows, { 'gpt-test': 32_000 });
  assert.equal(Object.hasOwn(normalized.ai.providers.openai!, 'contextWindows'), false);
});

test('migra credenciales heredadas de embeddings cuando coinciden con Provider', () => {
  const legacy = validSettings();
  delete legacy.ai.providers.openai.models.embeddings;
  legacy.embeddingConfig = {
    apiKey: 'secret', baseUrl: 'https://api.openai.com/v1/', model: 'text-embedding-3-small',
  };
  const normalized = validateRuntimeSettings(legacy);
  assert.deepEqual(normalized.embeddingConfig, { model: 'openai/text-embedding-3-small' });
  assert.deepEqual(normalized.ai.providers.openai?.models.embeddings, ['text-embedding-3-small']);
});

test('valida que el modelo de embeddings pertenezca al catálogo del proveedor', () => {
  const missingCatalogModel = validSettings();
  missingCatalogModel.embeddingConfig.model = 'openai/text-embedding-3-large';
  assert.throws(() => validateRuntimeSettings(missingCatalogModel), /is not listed.*models.embeddings/);

  const malformedModel = validSettings();
  malformedModel.embeddingConfig.model = 'text-embedding-3-small';
  assert.throws(() => validateRuntimeSettings(malformedModel), /expected provider\/model/);

  const disabled = validSettings();
  disabled.embeddingConfig = null;
  assert.equal(validateRuntimeSettings(disabled).embeddingConfig, null);
});

test('rechaza URLs de proveedor inválidas y proveedores/capacidades no permitidos', () => {
  const invalidUrl = validSettings();
  invalidUrl.ai.providers.openai.baseUrl = 'ftp://voice.local/v1';
  assert.throws(() => validateRuntimeSettings(invalidUrl), /Invalid baseUrl/);

  const noRealtimeVoices = validSettings();
  delete noRealtimeVoices.ai.providers.openai.realtime;
  assert.throws(() => validateRuntimeSettings(noRealtimeVoices), /realtime.voices is required/);
});

test('rechaza proveedores no permitidos y URLs MCP con credenciales', () => {
  const unknownProvider = validSettings();
  unknownProvider.ai.providers.anthropic = { apiKey: 'secret', models: { chat: ['x'] } };
  assert.throws(() => validateRuntimeSettings(unknownProvider), /Invalid provider/);

  const invalidUrl = validSettings();
  invalidUrl.mcpConfig.local.url = 'https://user:pass@mcp.example.test';
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
