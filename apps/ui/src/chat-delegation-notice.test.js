import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const chatSource = await readFile(new URL('./Chat.jsx', import.meta.url), 'utf8');
const chatMessagesSource = await readFile(new URL('./ChatMessages.jsx', import.meta.url), 'utf8');
const conversationListSource = await readFile(new URL('./ConversationList.jsx', import.meta.url), 'utf8');

test('el chat no muestra un aviso redundante por el estado persistente de delegación', () => {
  assert.doesNotMatch(chatSource, /visibleDelegationStatus|delegation-chat-status|DELEGATION_LABELS/);
});

test('la presentación de mensajes y el seguimiento de delegaciones quedan en ChatMessages', () => {
  assert.match(chatSource, /import \{ MessageList, ThinkingIndicator \} from '\.\/ChatMessages\.jsx'/);
  assert.match(chatSource, /<MessageList messages=\{messages\}/);
  assert.doesNotMatch(chatSource, /formatToolOutput/);
  assert.match(chatSource, /status: 'done', toolName: name, toolResult: output/);
  assert.match(chatMessagesSource, /export function MessageList/);
  assert.match(chatMessagesSource, /function DelegationCard/);
  assert.match(chatMessagesSource, /delegation-events/);
  assert.match(chatMessagesSource, /El resultado quedó guardado en la conversación de destino/);
  assert.match(conversationListSource, /delegationLabels\[delegation\?\.status\]/);
});
