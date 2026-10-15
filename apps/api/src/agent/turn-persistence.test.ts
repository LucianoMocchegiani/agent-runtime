import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemoryService } from 'agent-runtime-memory-contract';
import { persistAgentTurn } from './turn-persistence.js';

function memorySpy(saved: unknown[]) {
  return {
    saveMessage: async (message: unknown) => { saved.push(message); },
  } as unknown as MemoryService;
}

test('persists assistant step text and tool results in stream order', async () => {
  const saved: unknown[] = [];
  await persistAgentTurn(
    memorySpy(saved),
    'conversation-1',
    'user-1',
    'final response',
    [{
      text: 'Checking the record.',
      toolCalls: [{ toolName: 'lookup', input: { key: 'x' } }],
      toolResults: [{ output: { ok: true } }],
    }],
  );

  assert.deepEqual(saved, [
    {
      conversationId: 'conversation-1',
      userId: 'user-1',
      role: 'assistant',
      content: 'Checking the record.',
    },
    {
      conversationId: 'conversation-1',
      userId: 'user-1',
      role: 'tool',
      toolName: 'lookup',
      toolArgs: { key: 'x' },
      toolResult: { ok: true },
      content: 'lookup → {"ok":true}',
    },
  ]);
});

test('persists final text when no step contains assistant text', async () => {
  const saved: unknown[] = [];
  await persistAgentTurn(memorySpy(saved), 'conversation-1', 'user-1', '  Answer.  ', []);

  assert.deepEqual(saved, [{
    conversationId: 'conversation-1',
    userId: 'user-1',
    role: 'assistant',
    content: 'Answer.',
  }]);
});

test('persists step text when final text is absent', async () => {
  const saved: unknown[] = [];
  await persistAgentTurn(
    memorySpy(saved),
    'conversation-1',
    'user-1',
    undefined,
    [{ text: 'Step answer.' }],
  );

  assert.deepEqual(saved, [{
    conversationId: 'conversation-1',
    userId: 'user-1',
    role: 'assistant',
    content: 'Step answer.',
  }]);
});
