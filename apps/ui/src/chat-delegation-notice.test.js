import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const chatSource = await readFile(new URL('./Chat.jsx', import.meta.url), 'utf8');
const chatMessagesSource = await readFile(new URL('./ChatMessages.jsx', import.meta.url), 'utf8');
const conversationListSource = await readFile(new URL('./ConversationList.jsx', import.meta.url), 'utf8');
const chatAttachmentsSource = await readFile(new URL('./useChatAttachments.js', import.meta.url), 'utf8');
const chatVoiceSource = await readFile(new URL('./useChatVoice.js', import.meta.url), 'utf8');
const chatHistorySource = await readFile(new URL('./useChatHistory.js', import.meta.url), 'utf8');

test('el chat no muestra un aviso redundante por el estado persistente de delegación', () => {
  assert.doesNotMatch(chatSource, /visibleDelegationStatus|delegation-chat-status|DELEGATION_LABELS/);
});

test('la selección, lectura y retención de adjuntos de imagen quedan en su hook', () => {
  assert.match(chatSource, /import useChatAttachments, \{ MAX_IMAGES \} from '\.\/useChatAttachments\.js'/);
  assert.match(chatSource, /useChatAttachments\(\{ setError \}\)/);
  assert.doesNotMatch(chatSource, /FileReader|imageReadQueueRef|imagePreviewsRef|SUPPORTED_IMAGE_TYPES/);
  assert.match(chatAttachmentsSource, /function fileAsDataUrl/);
  assert.match(chatAttachmentsSource, /handlePaste/);
  assert.match(chatAttachmentsSource, /addLocalImagePreviews/);
  assert.match(chatAttachmentsSource, /rememberLocalImagePreview/);
});

test('la captura, síntesis y reproducción de voz quedan en su hook', () => {
  assert.match(chatSource, /import useChatVoice from '\.\/useChatVoice\.js'/);
  assert.match(chatSource, /useChatVoice\(\{[\s\S]*onSubmitTranscript:/);
  assert.doesNotMatch(chatSource, /RTCPeerConnection|createRealtimeToken|voiceSynthesisQueueRef|new Audio\(/);
  assert.match(chatVoiceSource, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(chatVoiceSource, /client\.voice\.synthesize/);
  assert.match(chatVoiceSource, /function handleCancelVoice/);
});

test('la carga, paginación y scroll del historial quedan en su hook', () => {
  assert.match(chatSource, /import useChatHistory from '\.\/useChatHistory\.js'/);
  assert.match(chatSource, /useChatHistory\(\{ conversationId, isVisible, delegationStatus, addLocalImagePreviews, setError \}\)/);
  assert.doesNotMatch(chatSource, /messageLoadRequestRef|loadOlderMessages|scrollRestoreRef|MESSAGE_PAGE_SIZE/);
  assert.match(chatHistorySource, /client\.messages\.list\(conversationId, \{ limit: MESSAGE_PAGE_SIZE, before \}\)/);
  assert.match(chatHistorySource, /container\.scrollTop = top \+ \(container\.scrollHeight - height\)/);
  assert.match(chatHistorySource, /retryHistoryLoad/);
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
