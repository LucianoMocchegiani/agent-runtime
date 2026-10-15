import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemoryService, GetContextResult } from 'agent-runtime-memory-contract';
import type { ResolvedModel } from '../llm/provider.js';
import { prepareTurnContext } from './turn-context.js';

const context: GetContextResult = {
  messages: [{
    id: 'message-1',
    conversationId: 'conversation-1',
    role: 'user',
    content: 'Ayudame con este recibo',
    toolName: null,
    toolArgs: null,
    toolResult: null,
    createdAt: '2025-01-01T00:00:00.000Z',
  }],
  summary: null,
  summaryRevision: 0,
  summaryThroughMessageId: null,
  summaryThroughCreatedAt: null,
  hasMore: false,
};

test('prepares prompt, token limits and multimodal messages with applicable preferences', async () => {
  let preferenceQuery = '';
  const memory = {
    searchPreferences: async (params: { query: string }) => {
      preferenceQuery = params.query;
      return [{
        id: 'preference-1',
        preference: 'Usar respuestas concisas',
        activationCondition: 'Al responder consultas',
        category: 'estilo',
        createdAt: '2025-01-01T00:00:00.000Z',
      }];
    },
  } as unknown as MemoryService;
  const model = {
    contextWindowTokens: 8_000,
  } as ResolvedModel;
  const imageData = new Uint8Array([1, 2, 3]);

  const prepared = await prepareTurnContext({
    memory,
    model,
    conversationId: 'conversation-1',
    userId: 'user-1',
    userText: 'Ayudame con este recibo',
    context,
    runtimeSettings: {
      summariesEnabled: false,
      summaryTokenBudget: 500,
      maxOutputTokens: 1_000,
      reserveOutputTokens: 1_200,
      contextSafetyTokens: 100,
      maxContextMessages: 20,
    },
    systemPrompt: 'Instrucciones del sistema',
    tools: {},
    images: [{ data: imageData, mediaType: 'image/png' }],
  });

  assert.match(preferenceQuery, /Ayudame con este recibo/);
  assert.equal(prepared.outputTokenLimits.maxOutputTokens, 1_000);
  assert.match(prepared.systemPrompt, /Instrucciones del sistema/);
  assert.match(prepared.systemPrompt, /Usar respuestas concisas/);
  assert.equal(prepared.messages.length, 1);
  const userMessage = prepared.messages[0];
  assert.equal(userMessage.role, 'user');
  assert.ok(Array.isArray(userMessage.content));
  assert.deepEqual(userMessage.content, [
    { type: 'text', text: 'Ayudame con este recibo' },
    { type: 'image', image: imageData, mediaType: 'image/png' },
  ]);
});
