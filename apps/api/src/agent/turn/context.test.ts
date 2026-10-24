import assert from 'node:assert/strict';
import test from 'node:test';
import type { GetContextResult } from '../../messages/contracts.js';
import type { ResolvedModel } from '../../llm/provider.js';
import { prepareTurnContext } from './context.js';

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

const common = {
  saveSummary: async () => true,
  searchPreferences: async () => [],
  model: { contextWindowTokens: 8_000 } as ResolvedModel,
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
  images: [],
};

test('prepares prompt, token limits and multimodal messages with applicable preferences', async () => {
  let preferenceQuery = '';
  const imageData = new Uint8Array([1, 2, 3]);
  const prepared = await prepareTurnContext({
    ...common,
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
    objective: null,
    images: [{ data: imageData, mediaType: 'image/png' }],
  });

  assert.match(preferenceQuery, /Ayudame con este recibo/);
  assert.equal(prepared.outputTokenLimits.maxOutputTokens, 1_000);
  assert.match(prepared.systemPrompt, /Instrucciones del sistema/);
  assert.match(prepared.systemPrompt, /Usar respuestas concisas/);
  assert.doesNotMatch(prepared.systemPrompt, /Objetivo operativo persistente/);
  assert.equal(prepared.messages.length, 1);
  const userMessage = prepared.messages[0];
  assert.equal(userMessage.role, 'user');
  assert.ok(Array.isArray(userMessage.content));
  assert.deepEqual(userMessage.content, [
    { type: 'text', text: 'Ayudame con este recibo' },
    { type: 'image', image: imageData, mediaType: 'image/png' },
  ]);
});

test('includes persisted objective independently of compacted history', async () => {
  const prepared = await prepareTurnContext({
    ...common,
    objective: {
      id: 'objective-1',
      conversationId: 'conversation-1',
      title: 'Preparar propuesta',
      description: 'Entregar versión revisada',
      status: 'active',
      steps: [{ id: 'draft', description: 'Revisar borrador', status: 'in_progress' }],
      nextStep: 'Validar costos',
      revision: 3,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    },
  });

  assert.match(prepared.systemPrompt, /Preparar propuesta/);
  assert.match(prepared.systemPrompt, /Validar costos/);
  assert.match(prepared.systemPrompt, /revision 3/);
  assert.match(prepared.systemPrompt, /no reconstruyas ni reemplaces el estado desde el resumen/i);
});
