import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CORS_ORIGIN ||= 'https://app.example.test';
const [{ config }, { validateAgentProfileInput }] = await Promise.all([
  import('../config.js'),
  import('./agent-profile-validation.js'),
]);
config.ai.providers.openai = {
  apiKey: 'test-key', baseUrl: 'https://api.openai.com/v1',
  models: { chat: ['gpt-test'], realtime: ['gpt-realtime'] },
  realtime: { voices: ['voice-test'] },
};

function validProfileConfig(): Record<string, unknown> {
  return {
    systemPrompt: 'system',
    chat: {
      contextTokenBudget: 10_000, maxContextMessages: 20,
      maxOutputTokens: 4_096, reserveOutputTokens: 4_096, contextSafetyTokens: 512,
      maxToolSteps: 8, llmTraceRequests: false, summariesEnabled: true, summaryTokenBudget: 300,
    },
  };
}

const chatModel = { chat: 'openai/gpt-test' };

test('normaliza el nombre, los modelos y los ajustes separados de chat', () => {
  const result = validateAgentProfileInput('  Perfil  ', { chat: ' openai/gpt-test ', realtime: ' gpt-realtime ' }, validProfileConfig());
  assert.equal(result.name, 'Perfil');
  assert.deepEqual(result.model, { chat: 'openai/gpt-test', realtime: 'gpt-realtime' });
  assert.equal(result.config.chat.contextTokenBudget, 10_000);
  assert.equal(result.config.systemPrompt, 'system');
});

test('realtime tiene límites dinámicos por perfil y aplica defaults si se omiten', () => {
  const disabled = validateAgentProfileInput('Perfil', chatModel, validProfileConfig());
  assert.equal(disabled.config.realtime, undefined);

  const enabled = validateAgentProfileInput('Perfil', { ...chatModel, realtime: 'gpt-realtime' }, {
    ...validProfileConfig(), realtime: { voice: 'voice-test' },
  });
  assert.deepEqual(enabled.config.realtime, {
    voice: 'voice-test', maxContextMessages: 12, maxInstructionsCharacters: 24_000,
    maxMessageCharacters: 4_000, maxToolResultCharacters: 2_000, maxSummaryCharacters: 4_000,
    maxOutputTokens: 4_096,
    vad: { threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 500, createResponse: true, interruptResponse: true },
  });

  const custom = validateAgentProfileInput('Perfil', { ...chatModel, realtime: 'gpt-realtime' }, {
    ...validProfileConfig(), realtime: {
      voice: 'voice-test', maxContextMessages: 32, maxInstructionsCharacters: 48_000,
    },
  });
  assert.deepEqual(custom.config.realtime, {
    voice: 'voice-test', maxContextMessages: 32, maxInstructionsCharacters: 48_000,
    maxMessageCharacters: 4_000, maxToolResultCharacters: 2_000, maxSummaryCharacters: 4_000,
    maxOutputTokens: 4_096,
    vad: { threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 500, createResponse: true, interruptResponse: true },
  });
});

test('normaliza límites de salida/contexto y parámetros VAD por perfil', () => {
  const result = validateAgentProfileInput('Perfil', { ...chatModel, realtime: 'gpt-realtime' }, {
    ...validProfileConfig(),
    realtime: {
      voice: 'voice-test', maxContextMessages: 5, maxInstructionsCharacters: 8_000,
      maxMessageCharacters: 1_200, maxToolResultCharacters: 800, maxSummaryCharacters: 900,
      maxOutputTokens: 2_048,
      vad: { threshold: 0.7, prefixPaddingMs: 250, silenceDurationMs: 700, createResponse: false, interruptResponse: false },
    },
  });
  assert.deepEqual(result.config.realtime, {
    voice: 'voice-test', maxContextMessages: 5, maxInstructionsCharacters: 8_000,
    maxMessageCharacters: 1_200, maxToolResultCharacters: 800, maxSummaryCharacters: 900,
    maxOutputTokens: 2_048,
    vad: { threshold: 0.7, prefixPaddingMs: 250, silenceDurationMs: 700, createResponse: false, interruptResponse: false },
  });
});

test('realtime requiere un modelo y una voz publicados por Provider y rechaza campos no admitidos', () => {
  assert.throws(() => validateAgentProfileInput('Perfil', { ...chatModel, realtime: 'gpt-realtime' }, {
    ...validProfileConfig(), realtime: { voice: 'disabled' },
  }), /voz del perfil debe estar habilitada/);
  assert.throws(() => validateAgentProfileInput('Perfil', chatModel, {
    ...validProfileConfig(), realtime: { voice: 'voice-test' },
  }), /model.realtime es obligatorio/);
  assert.throws(() => validateAgentProfileInput('Perfil', { ...chatModel, realtime: 'gpt-realtime' }, {
    ...validProfileConfig(), realtime: { voice: 'voice-test', speechModel: 'tts-1' },
  }), /campos no admitidos: speechModel/);
  assert.throws(() => validateAgentProfileInput('Perfil', chatModel, {
    ...validProfileConfig(), voice: { realtime: { voice: 'voice-test' } },
  }), /campos no admitidos: voice/);
});

test('rechaza perfiles incompletos, números fuera de rango y modelos deshabilitados', () => {
  const missingField = validProfileConfig();
  delete (missingField.chat as Record<string, unknown>).summaryTokenBudget;
  assert.throws(() => validateAgentProfileInput('Perfil', chatModel, missingField), /Falta summaryTokenBudget en config.chat/);

  const tooLarge = validProfileConfig();
  (tooLarge.chat as Record<string, unknown>).maxToolSteps = 10_000_001;
  assert.throws(() => validateAgentProfileInput('Perfil', chatModel, tooLarge), /config.chat.maxToolSteps debe ser un entero positivo/);

  assert.throws(() => validateAgentProfileInput('Perfil', { chat: 'openai/disabled' }, validProfileConfig()), /no está habilitado/);
  assert.throws(() => validateAgentProfileInput('Perfil', { ...chatModel, realtime: 'gpt-realtime' }, {
    ...validProfileConfig(), realtime: { voice: 'voice-test', maxContextMessages: 0 },
  }), /maxContextMessages debe ser un entero/);
  assert.throws(() => validateAgentProfileInput('Perfil', { ...chatModel, realtime: 'gpt-realtime' }, {
    ...validProfileConfig(), realtime: { voice: 'voice-test', vad: { threshold: 1.1 } },
  }), /vad.threshold debe ser un número entre 0 y 1/);
  assert.throws(() => validateAgentProfileInput('Perfil', { ...chatModel, realtime: 'gpt-realtime' }, {
    ...validProfileConfig(), realtime: { voice: 'voice-test', maxOutputTokens: 4_097 },
  }), /maxOutputTokens debe ser un entero/);
});
