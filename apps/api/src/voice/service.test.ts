import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { config } from '../config.js';
import type { AgentProfileRealtimeConfig } from '../runtime-config/contracts.js';
import { createRealtimeVoiceSession, isVoiceAvailable, VoiceServiceError } from './service.js';

const originalAi = structuredClone(config.ai);
const originalFetch = globalThis.fetch;
const profile: AgentProfileRealtimeConfig = {
  voice: 'alloy', maxContextMessages: 12, maxInstructionsCharacters: 24_000,
  maxMessageCharacters: 4_000, maxToolResultCharacters: 2_000, maxSummaryCharacters: 4_000,
  maxOutputTokens: 4_096,
  vad: { threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 500, createResponse: true, interruptResponse: true },
};
const realtimeModel = 'gpt-realtime';

function configureVoice(): void {
  config.ai.providers.openai = {
    apiKey: 'test-secret',
    baseUrl: 'https://voice.test/v1',
    models: { chat: [], realtime: [realtimeModel] },
    realtime: { voices: ['alloy'] },
  };
}

afterEach(() => {
  config.ai = structuredClone(originalAi);
  globalThis.fetch = originalFetch;
});

test('Realtime session uses profile model and voice and returns only an ephemeral secret', async () => {
  configureVoice();
  const tools = [{ type: 'function', name: 'get_delegation_status', parameters: { type: 'object' } }];
  let requestBody: any;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ value: 'ephemeral-secret', expires_at: 12345 });
  };

  assert.equal(isVoiceAvailable(profile, realtimeModel), true);
  const session = await createRealtimeVoiceSession(profile, realtimeModel, 'Be helpful', tools);
  assert.deepEqual(session, {
    value: 'ephemeral-secret',
    expiresAt: 12345,
    realtimeUrl: 'https://voice.test/v1/realtime/calls',
  });
  assert.equal(requestBody.session.model, realtimeModel);
  assert.equal(requestBody.session.max_output_tokens, 4_096);
  assert.equal(requestBody.session.instructions, 'Be helpful');
  assert.deepEqual(requestBody.session.tools, tools);
  assert.equal(requestBody.session.tool_choice, 'auto');
  assert.deepEqual(requestBody.session.audio.input, {
    turn_detection: {
      type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500,
      create_response: true, interrupt_response: true,
    },
  });
  assert.equal(requestBody.session.audio.output.voice, 'alloy');
  assert.equal(Object.hasOwn(requestBody.session.audio.input, 'transcription'), false);
});

test('Realtime session sends the profile output and VAD limits to the provider', async () => {
  configureVoice();
  let requestBody: any;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ value: 'ephemeral-secret' });
  };
  const customProfile: AgentProfileRealtimeConfig = {
    ...profile,
    maxOutputTokens: 1_024,
    vad: { threshold: 0.8, prefixPaddingMs: 200, silenceDurationMs: 800, createResponse: false, interruptResponse: false },
  };
  await createRealtimeVoiceSession(customProfile, realtimeModel, 'Be helpful');
  assert.equal(requestBody.session.max_output_tokens, 1_024);
  assert.deepEqual(requestBody.session.audio.input.turn_detection, {
    type: 'server_vad', threshold: 0.8, prefix_padding_ms: 200, silence_duration_ms: 800,
    create_response: false, interrupt_response: false,
  });
});

test('Realtime session is unavailable when the profile model is not in the configured catalog', async () => {
  configureVoice();
  const invalidModel = 'unlisted-model';
  assert.equal(isVoiceAvailable(profile, invalidModel), false);
  await assert.rejects(
    createRealtimeVoiceSession(profile, invalidModel, 'Be helpful'),
    (error: unknown) => error instanceof VoiceServiceError && error.status === 503,
  );
});
