import assert from 'node:assert/strict';
import test from 'node:test';
import type { Tool } from 'ai';
import type { MessageDto } from 'agent-runtime-memory-contract';
import { buildModelMessages, resolveTokenReserves, selectModelContext } from './window.js';

function message(
  id: string,
  role: MessageDto['role'],
  content: string,
  extra: Partial<MessageDto> = {},
): MessageDto {
  return {
    id,
    conversationId: 'conversation-1',
    role,
    content,
    toolName: null,
    toolArgs: null,
    toolResult: null,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

function build(rows: MessageDto[], contextWindowTokens: number) {
  return buildModelMessages(rows, {
    contextWindowTokens,
    responseTokenReserve: 0,
    safetyTokens: 0,
    systemPrompt: '',
    tools: {} as Record<string, Tool>,
  });
}

test('keeps a contiguous suffix of complete turns, without skipping an oversized older turn', () => {
  const rows = [
    message('old-user', 'user', 'old'),
    message('old-assistant', 'assistant', 'answer'),
    message('new-user', 'user', 'new'),
    message('new-assistant', 'assistant', 'reply'),
  ];

  // The newest turn costs 11 estimated tokens; the older one cannot fit beside it.
  const result = build(rows, 11);

  assert.deepEqual(result, [
    { role: 'user', content: 'new' },
    { role: 'assistant', content: 'reply' },
  ]);
});

test('reports only the contiguous older turns omitted from the model context', () => {
  const rows = [
    message('old-user', 'user', 'old'),
    message('old-assistant', 'assistant', 'answer'),
    message('new-user', 'user', 'new'),
    message('new-assistant', 'assistant', 'reply'),
  ];
  const selected = selectModelContext(rows, {
    contextWindowTokens: 11,
    responseTokenReserve: 0,
    safetyTokens: 0,
    systemPrompt: '',
    tools: {},
  });

  assert.deepEqual(selected.omittedRows.map(({ id }) => id), ['old-user', 'old-assistant']);
  assert.deepEqual(selected.messages, build(rows.slice(2), 11));
});

test('does not resend persisted tool results in conversation context', () => {
  const rows = [
    message('user', 'user', 'question'),
    message('assistant-call', 'assistant', 'Checking.'),
    message('tool', 'tool', '', {
      toolName: 'lookup',
      toolArgs: { key: 'x' },
      toolResult: { value: 'y' },
    }),
    message('assistant-final', 'assistant', 'Here is the answer.'),
  ];

  const result = build(rows, 1);

  assert.deepEqual(result, [
    { role: 'user', content: 'question' },
    { role: 'assistant', content: 'Checking.' },
    { role: 'assistant', content: 'Here is the answer.' },
  ]);
});

test('caps context at 20 messages, keeping the newest complete turns and current user message', () => {
  const rows: MessageDto[] = [];
  for (let turn = 0; turn < 12; turn += 1) {
    rows.push(message(`user-${turn}`, 'user', `question-${turn}`));
    rows.push(message(`assistant-${turn}`, 'assistant', `answer-${turn}`));
  }
  rows.push(message('current-user', 'user', 'current question'));

  const selected = selectModelContext(rows, {
    contextWindowTokens: 100_000,
    responseTokenReserve: 0,
    safetyTokens: 0,
    systemPrompt: '',
    tools: {},
    maxMessages: 20,
  });

  assert.equal(selected.messages.length, 19);
  assert.equal(selected.messages[0]?.content, 'question-3');
  assert.equal(selected.messages.at(-1)?.content, 'current question');
  assert.deepEqual(selected.omittedRows.map(({ id }) => id), [
    'user-0', 'assistant-0', 'user-1', 'assistant-1', 'user-2', 'assistant-2',
  ]);
});

test('tool result rows do not consume the model context budget', () => {
  const rows = [
    message('user', 'user', 'question'),
    message('tool-1', 'tool', '', {
      toolName: 'lookup',
      toolResult: 'x'.repeat(20_000),
    }),
    message('assistant', 'assistant', 'Answer.'),
  ];

  const result = build(rows, 10);

  assert.deepEqual(result, [
    { role: 'user', content: 'question' },
    { role: 'assistant', content: 'Answer.' },
  ]);
});

test('accounts for system instructions, tools, and response/safety reserves before older turns', () => {
  const rows = [
    message('old-user', 'user', 'old'),
    message('old-assistant', 'assistant', 'answer'),
    message('new-user', 'user', 'new'),
  ];
  const result = buildModelMessages(rows, {
    contextWindowTokens: 24,
    responseTokenReserve: 5,
    safetyTokens: 2,
    systemPrompt: 'system prompt',
    tools: { lookup: { description: 'tool definition' } as Tool },
  });

  assert.deepEqual(result, [{ role: 'user', content: 'new' }]);
});

test('normalizes output and safety reserves for small model windows', () => {
  assert.deepEqual(resolveTokenReserves(10_000, 2_048, 512), {
    responseTokenReserve: 2_048,
    safetyTokens: 512,
  });
  assert.deepEqual(resolveTokenReserves(500, 2_048, 512), {
    responseTokenReserve: 1,
    safetyTokens: 499,
  });
});
