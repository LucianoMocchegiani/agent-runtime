import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
const delegationTrackingSource = await readFile(new URL('./useDelegationTracking.js', import.meta.url), 'utf8');
const chatSource = await readFile(new URL('./Chat.jsx', import.meta.url), 'utf8');
const chatMessagesSource = await readFile(new URL('./ChatMessages.jsx', import.meta.url), 'utf8');
const toolMessagesSource = await readFile(new URL('./ToolMessages.jsx', import.meta.url), 'utf8');
const markdownContentSource = await readFile(new URL('./MarkdownContent.jsx', import.meta.url), 'utf8');
const conversationListSource = await readFile(new URL('./ConversationList.jsx', import.meta.url), 'utf8');
const chatAttachmentsSource = await readFile(new URL('./useChatAttachments.js', import.meta.url), 'utf8');
const chatVoiceSource = await readFile(new URL('./useChatVoice.js', import.meta.url), 'utf8');
const chatHistorySource = await readFile(new URL('./useChatHistory.js', import.meta.url), 'utf8');
const chatTurnSource = await readFile(new URL('./useChatTurn.js', import.meta.url), 'utf8');
const chatComposerSource = await readFile(new URL('./useChatComposer.js', import.meta.url), 'utf8');
const chatComposerViewSource = await readFile(new URL('./ChatComposer.jsx', import.meta.url), 'utf8');
const chatHeaderSource = await readFile(new URL('./ChatHeader.jsx', import.meta.url), 'utf8');

test('el chat no muestra un aviso redundante por el estado persistente de delegación', () => {
  assert.doesNotMatch(chatSource, /visibleDelegationStatus|delegation-chat-status|DELEGATION_LABELS/);
});

test('la carga y el seguimiento SSE de delegaciones quedan en su hook', () => {
  assert.match(appSource, /import useDelegationTracking from '\.\/useDelegationTracking\.js'/);
  assert.match(appSource, /useDelegationTracking\(\)/);
  assert.doesNotMatch(appSource, /client\.delegations\.(list|get|events)|new AbortController\(|activeDelegationIds/);
  assert.match(delegationTrackingSource, /client\.delegations\.list\(\)/);
  assert.match(delegationTrackingSource, /client\.delegations\.events/);
  assert.match(delegationTrackingSource, /AbortController/);
  assert.match(delegationTrackingSource, /refreshDelegations/);
});

test('la selección, lectura y retención de adjuntos de imagen quedan en su hook', () => {
  assert.match(chatSource, /import useChatAttachments from '\.\/useChatAttachments\.js'/);
  assert.match(chatSource, /useChatAttachments\(\{ setError \}\)/);
  assert.match(chatComposerViewSource, /import \{ MAX_IMAGES \} from '\.\/useChatAttachments\.js'/);
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

test('el envío, el streaming y la cancelación del turno quedan en su hook', () => {
  assert.match(chatSource, /import useChatTurn, \{ DELEGATION_ACTIVE_STATUSES \} from '\.\/useChatTurn\.js'/);
  assert.match(chatSource, /useChatTurn\(\{[\s\S]*rememberLocalImagePreview,[\s\S]*voice,/);
  assert.doesNotMatch(chatSource, /client\.messages\.(send|edit)|new AbortController\(|onTextDelta:/);
  assert.match(chatTurnSource, /client\.messages\.send/);
  assert.match(chatTurnSource, /client\.messages\.edit/);
  assert.match(chatTurnSource, /onToolStart/);
  assert.match(chatTurnSource, /function handleAbort/);
  assert.match(chatTurnSource, /finishVoiceReply\(\)/);
});

test('el borrador, la edición y la interacción del textarea quedan en su hook', () => {
  assert.match(chatSource, /import useChatComposer from '\.\/useChatComposer\.js'/);
  assert.match(chatSource, /useChatComposer\(\{[\s\S]*canStartEditingMessage,[\s\S]*onClearError:/);
  assert.doesNotMatch(chatSource, /const \[input, setInput\]|function handleInputKeyDown|inputBeforeEditRef = useRef|textarea\.style\.height/);
  assert.match(chatComposerSource, /function startEditingMessage/);
  assert.match(chatComposerSource, /function cancelEditingMessage/);
  assert.match(chatComposerSource, /function handleInputKeyDown/);
  assert.match(chatComposerSource, /textarea\.style\.height = 'auto'/);
  assert.match(chatComposerSource, /MAX_MESSAGE_CHARS = 100_000/);
  assert.match(chatSource, /import ChatComposer from '\.\/ChatComposer\.jsx'/);
  assert.match(chatSource, /<ChatComposer[\s\S]*handleAbort=\{handleAbort\}/);
  assert.doesNotMatch(chatSource, /<form onSubmit=\{handleSubmit\} className="composer"/);
  assert.match(chatComposerViewSource, /<form onSubmit=\{onSubmit\} className="composer"/);
  assert.match(chatComposerViewSource, /className="message-input"/);
  assert.match(chatComposerViewSource, /className="attach-button"/);
});

test('la cabecera, el título, el perfil y los controles de recarga y voz quedan en ChatHeader', () => {
  assert.match(chatSource, /import ChatHeader from '\.\/ChatHeader\.jsx'/);
  assert.match(chatSource, /<ChatHeader[\s\S]*loadMessages=\{loadMessages\}/);
  assert.doesNotMatch(chatSource, /<header className="chat-header">|className="conversation-title-form"|className="chat-profile-picker"/);
  assert.match(chatHeaderSource, /className="chat-header"/);
  assert.match(chatHeaderSource, /conversation-title-form/);
  assert.match(chatHeaderSource, /chat-profile-picker/);
  assert.match(chatHeaderSource, /Preparando audio/);
  assert.match(chatHeaderSource, /loadMessages\(\{ preserveHistory: true \}\)/);
});

test('la lista de mensajes y la presentación de herramientas quedan separadas', () => {
  assert.match(chatSource, /import \{ MessageList, ThinkingIndicator \} from '\.\/ChatMessages\.jsx'/);
  assert.match(chatSource, /<MessageList messages=\{messages\}/);
  assert.doesNotMatch(chatSource, /formatToolOutput/);
  assert.match(chatTurnSource, /status: 'done', toolName: name, toolResult: output/);
  assert.match(chatMessagesSource, /export function MessageList/);
  assert.match(chatMessagesSource, /import \{ collectToolMessages, ToolMessage, ToolStack \} from '\.\/ToolMessages\.jsx'/);
  assert.doesNotMatch(chatMessagesSource, /function DelegationCard|function formatToolOutput/);
  assert.match(toolMessagesSource, /function DelegationCard/);
  assert.match(toolMessagesSource, /function formatToolOutput/);
  assert.match(toolMessagesSource, /function ToolStack/);
  assert.match(toolMessagesSource, /function collectToolMessages/);
  assert.match(toolMessagesSource, /delegation-events/);
  assert.match(toolMessagesSource, /El resultado quedó guardado en la conversación de destino/);
  assert.match(conversationListSource, /delegationLabels\[delegation\?\.status\]/);
});

test('el renderizado de Markdown queda separado de las burbujas y la lista de mensajes', () => {
  assert.match(chatMessagesSource, /import MarkdownContent from '\.\/MarkdownContent\.jsx'/);
  assert.doesNotMatch(chatMessagesSource, /function renderMarkdownBlocks|function MarkdownInline|function MermaidDiagram/);
  assert.match(markdownContentSource, /export default function MarkdownContent/);
  assert.match(markdownContentSource, /function renderMarkdownBlocks/);
  assert.match(markdownContentSource, /function MermaidDiagram/);
  assert.match(markdownContentSource, /function MarkdownInline/);
  assert.match(markdownContentSource, /isMarkdownTableSeparator/);
});
