import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AUTH_INTROSPECT_URL ||= 'https://auth.example.test/introspect';
process.env.CORS_ORIGIN ||= 'https://app.example.test';
const [{ config }, { validateAgentProfileInput }] = await Promise.all([
  import('../config.js'),
  import('./agent-profile-validation.js'),
]);
config.ai.providers.openai = { apiKey: 'test-key', models: ['gpt-test'], contextWindows: {} };

function validProfileConfig(): Record<string, unknown> {
  return {
    chatSystemPrompt: 'system', contextTokenBudget: 10_000, maxContextMessages: 20,
    maxOutputTokens: 4_096, reserveOutputTokens: 4_096, contextSafetyTokens: 512,
    maxToolSteps: 8, llmTraceRequests: false, summariesEnabled: true, summaryTokenBudget: 300,
  };
}

test('normaliza el nombre y el modelId de un perfil validado', () => {
  const result = validateAgentProfileInput('  Perfil  ', 'openai/gpt-test', validProfileConfig());
  assert.equal(result.name, 'Perfil');
  assert.equal(result.modelId, 'openai/gpt-test');
  assert.equal(result.config.contextTokenBudget, 10_000);
});

test('rechaza perfiles incompletos, números fuera de rango y modelos deshabilitados', () => {
  const missingField = validProfileConfig();
  delete missingField.summaryTokenBudget;
  assert.throws(() => validateAgentProfileInput('Perfil', 'openai/gpt-test', missingField), /Falta summaryTokenBudget/);

  const tooLarge = validProfileConfig();
  tooLarge.maxToolSteps = 10_000_001;
  assert.throws(() => validateAgentProfileInput('Perfil', 'openai/gpt-test', tooLarge), /entero positivo/);

  assert.throws(() => validateAgentProfileInput('Perfil', 'openai/disabled', validProfileConfig()), /no está habilitado/);
});
