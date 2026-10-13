import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const chatSource = await readFile(new URL('./Chat.jsx', import.meta.url), 'utf8');
const conversationListSource = await readFile(new URL('./ConversationList.jsx', import.meta.url), 'utf8');

test('el chat no muestra un aviso redundante por el estado persistente de delegación', () => {
  assert.doesNotMatch(chatSource, /visibleDelegationStatus|delegation-chat-status|DELEGATION_LABELS/);
});

test('se conservan el detalle consultable de la delegación y su estado en la lista', () => {
  assert.match(chatSource, /function DelegationCard/);
  assert.match(chatSource, /delegation-events/);
  assert.match(chatSource, /El resultado quedó guardado en la conversación de destino/);
  assert.match(conversationListSource, /delegationLabels\[delegation\?\.status\]/);
});
