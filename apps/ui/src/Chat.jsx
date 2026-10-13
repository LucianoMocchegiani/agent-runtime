import { useState, useEffect, useRef, useCallback } from 'react';
import client from './client.js';
import Icon from './Icon.jsx';

const MAX_IMAGES = 10;
const MAX_MESSAGE_CHARS = 100_000;
const MESSAGE_PAGE_SIZE = 50;
const BOTTOM_SCROLL_THRESHOLD = 2;

function messageCursor(message) {
  return message ? { createdAt: message.createdAt, id: message.id } : null;
}

function sortMessages(items) {
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function compareMessageOrder(a, b) {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function isMessageAfter(message, target) {
  return compareMessageOrder(message, target) > 0;
}

function isMessageBefore(message, target) {
  return compareMessageOrder(message, target) < 0;
}

function hasUnstoredImage(message) {
  return message.content.includes('[Imagen adjunta; no almacenada]')
    || message.content.includes('imágenes adjuntas; no almacenadas]');
}

const DELEGATION_ACTIVE_STATUSES = new Set(['queued', 'running']);
export default function Chat({ conversationId, isVisible, delegationStatus, onOpenSidebar, onConversationUpdated, onActivityChange, onOpenConversation }) {
  const [messages, setMessages] = useState([]);
  const [conversationTitle, setConversationTitle] = useState('');
  const [agentProfileId, setAgentProfileId] = useState('');
  const [agentProfiles, setAgentProfiles] = useState([]);
  const [isChangingProfile, setIsChangingProfile] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [input, setInput] = useState('');
  const [editingMessage, setEditingMessage] = useState(null);
  const inputBeforeEditRef = useRef('');
  const [images, setImages] = useState([]);
  const [pendingImageReads, setPendingImageReads] = useState(0);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const imagesRef = useRef([]);
  const imageReadQueueRef = useRef(Promise.resolve());
  const [isLoading, setIsLoading] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [activity, setActivity] = useState('idle');
  const [voiceState, setVoiceState] = useState('idle');
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [handsFreeMode, setHandsFreeMode] = useState(false);
  const [handsFreeStatus, setHandsFreeStatus] = useState('off');
  const [voiceAudioUrl, setVoiceAudioUrl] = useState(null);
  const [isPreparingVoice, setIsPreparingVoice] = useState(false);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);
  const [error, setError] = useState(null);
  const [isHistoryStale, setIsHistoryStale] = useState(false);
  const scrollContainerRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const abortRef = useRef(null);
  const voiceSessionRef = useRef(null);
  const handsFreeModeRef = useRef(false);
  const handsFreeRestartRef = useRef(false);
  const speechSynthesisFinishedRef = useRef(false);
  const voiceSynthesisPendingRef = useRef(0);
  const voiceSynthesisQueueRef = useRef(Promise.resolve());
  const voiceSpeechPipelineRef = useRef(false);
  const voiceStartIdRef = useRef(0);
  const voiceTranscriptRef = useRef([]);
  const voiceAudioRef = useRef(null);
  const voiceAudioUrlRef = useRef(null);
  const voiceAudioUrlsRef = useRef([]);
  const voicePlaybackIndexRef = useRef(0);
  const voicePlaybackEnabledRef = useRef(false);
  const voiceSynthesisIdRef = useRef(0);
  const voiceTraceIdRef = useRef(null);
  const imagePreviewsRef = useRef([]);
  const messageLoadRequestRef = useRef(0);
  const messagesRef = useRef([]);
  const hasMoreMessagesRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const scrollRestoreRef = useRef(null);
  const messageInputRef = useRef(null);
  const imageFileInputRef = useRef(null);
  const attachmentMenuRef = useRef(null);
  messagesRef.current = messages;
  hasMoreMessagesRef.current = hasMoreMessages;

  useEffect(() => {
    const textarea = messageInputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = Number.parseFloat(getComputedStyle(textarea).maxHeight);
    textarea.style.height = `${Math.min(textarea.scrollHeight, Number.isFinite(maxHeight) ? maxHeight : textarea.scrollHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > textarea.clientHeight ? 'auto' : 'hidden';
  }, [input]);

  useEffect(() => {
    if (!isAttachMenuOpen) return;
    function handlePointerDown(event) {
      if (!attachmentMenuRef.current?.contains(event.target)) {
        setIsAttachMenuOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setIsAttachMenuOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAttachMenuOpen]);

  function replaceImages(nextImages) {
    const next = typeof nextImages === 'function' ? nextImages(imagesRef.current) : nextImages;
    imagesRef.current = next;
    setImages(next);
  }

  function handleImageFiles(files) {
    if (!files?.length) return;
    setError(null);
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const accepted = [];
    for (const file of files) {
      if (!supportedTypes.includes(file.type)) {
        setError('Formato no compatible. Adjuntá imágenes JPEG, PNG, WebP o GIF.');
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError(`La imagen ${file.name || ''} supera el límite de 5 MB.`.trim());
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;

    setPendingImageReads(count => count + 1);
    const task = imageReadQueueRef.current.then(async () => {
      const remaining = Math.max(0, MAX_IMAGES - imagesRef.current.length);
      if (remaining === 0) {
        setError(`Podés adjuntar hasta ${MAX_IMAGES} imágenes por mensaje.`);
        return;
      }
      if (accepted.length > remaining) {
        setError(`Podés adjuntar hasta ${MAX_IMAGES} imágenes por mensaje; se agregaron las primeras ${remaining}.`);
      }
      const selected = accepted.slice(0, remaining);
      const loaded = await Promise.all(selected.map(async file => ({
        dataUrl: await fileAsDataUrl(file),
        name: file.name || 'Imagen pegada',
      })));
      replaceImages(current => [...current, ...loaded]);
    }).catch(() => {
      setError('No se pudo leer una imagen. Probá con otro archivo.');
    });
    imageReadQueueRef.current = task;
    void task.finally(() => setPendingImageReads(count => Math.max(0, count - 1)));
  }

  function handleInputPaste(e) {
    if (isLoading || editingMessage) return;
    const files = [...(e.clipboardData?.items ?? [])]
      .filter(item => item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    void handleImageFiles(files);
  }

  function handleInputChange(e) {
    setInput(e.target.value);
  }

  function startEditingMessage(message) {
    if (isLoading || voiceState !== 'idle' || pendingImageReads > 0 || images.length > 0 || message.pending || message.role !== 'user') return;
    inputBeforeEditRef.current = input;
    setEditingMessage(message);
    setInput(message.content);
    setError(null);
    requestAnimationFrame(() => messageInputRef.current?.focus());
  }

  function cancelEditingMessage() {
    setEditingMessage(null);
    setInput(inputBeforeEditRef.current);
    inputBeforeEditRef.current = '';
  }

  function handleImageSelection(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    setIsAttachMenuOpen(false);
    if (files.length) void handleImageFiles(files);
  }

  function handleInputKeyDown(e) {
    if (e.key === 'Escape' && editingMessage) {
      e.preventDefault();
      cancelEditingMessage();
      return;
    }
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();

    if (e.shiftKey) {
      const textarea = e.currentTarget;
      const { selectionStart, selectionEnd, value } = textarea;
      const nextValue = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
      setInput(nextValue);
      requestAnimationFrame(() => {
        textarea.setSelectionRange(selectionStart + 1, selectionStart + 1);
      });
      return;
    }

    e.currentTarget.form?.requestSubmit();
  }
  
  const addLocalImagePreviews = useCallback((items) => {
    const previews = [...imagePreviewsRef.current];
    return items.map(message => {
      if (message.role !== 'user') return message;
      const previewIndex = previews.findIndex(preview => preview.content === message.content);
      if (previewIndex < 0) return message;
      const [preview] = previews.splice(previewIndex, 1);
      return { ...message, imageDataUrls: preview.dataUrls };
    });
  }, []);

  const loadMessages = useCallback(async ({ preserveHistory = false } = {}) => {
    const requestId = ++messageLoadRequestRef.current;
    if (!preserveHistory) {
      setMessages([]);
      setHasMoreMessages(false);
      hasMoreMessagesRef.current = false;
      loadingOlderRef.current = false;
      setIsLoadingOlder(false);
      shouldStickToBottomRef.current = true;
      scrollRestoreRef.current = null;
    }
    try {
      const page = await client.messages.list(conversationId, { limit: MESSAGE_PAGE_SIZE });
      if (requestId !== messageLoadRequestRef.current) return;
      const latestItems = addLocalImagePreviews(page.items);
      if (preserveHistory) {
        const retained = messagesRef.current.filter(message => !message.pending);
        const merged = new Map([...retained, ...latestItems].map(message => [message.id, message]));
        setMessages(sortMessages([...merged.values()]));
        setHasMoreMessages(hasMoreMessagesRef.current || page.hasMore);
      } else {
        setMessages(latestItems);
        setHasMoreMessages(page.hasMore);
      }
      hasMoreMessagesRef.current = preserveHistory
        ? hasMoreMessagesRef.current || page.hasMore
        : page.hasMore;
      setIsHistoryStale(false);
      return true;
    } catch (e) {
      if (requestId === messageLoadRequestRef.current) {
        setIsHistoryStale(true);
        setError(e.message);
      }
      return false;
    }
  }, [addLocalImagePreviews, conversationId]);

  const loadOlderMessages = useCallback(async () => {
    const currentMessages = messagesRef.current;
    const before = messageCursor(currentMessages[0]);
    if (!before || !hasMoreMessagesRef.current || loadingOlderRef.current) return;

    const requestId = messageLoadRequestRef.current;
    const container = scrollContainerRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    const previousTop = container?.scrollTop ?? 0;
    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    try {
      const page = await client.messages.list(conversationId, { limit: MESSAGE_PAGE_SIZE, before });
      if (requestId !== messageLoadRequestRef.current) return;
      const combined = new Map([...messagesRef.current, ...addLocalImagePreviews(page.items)].map(message => [message.id, message]));
      scrollRestoreRef.current = { height: previousHeight, top: previousTop };
      setMessages(sortMessages([...combined.values()]));
      setHasMoreMessages(page.hasMore);
      hasMoreMessagesRef.current = page.hasMore;
    } catch (e) {
      if (requestId === messageLoadRequestRef.current) setError(e.message);
    } finally {
      if (requestId === messageLoadRequestRef.current) {
        loadingOlderRef.current = false;
        setIsLoadingOlder(false);
      }
    }
  }, [addLocalImagePreviews, conversationId]);

  useEffect(() => {
    let isCurrent = true;
    setConversationTitle('');
    setIsEditingTitle(false);
    setEditingMessage(null);
    setInput('');
    inputBeforeEditRef.current = '';
    Promise.all([client.conversations.get(conversationId), client.agentProfiles.list()]).then(([conversation, profiles]) => {
      if (!isCurrent) return;
      setAgentProfiles(profiles);
      setAgentProfileId(conversation.agentProfileId ?? '');
      setConversationTitle(conversation.title ?? '');
      onConversationUpdated?.(conversation);
    }).catch(e => {
      if (isCurrent) setError(e.message);
    });
    return () => { isCurrent = false; };
  }, [conversationId, onConversationUpdated]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    let active = true;
    setVoiceAvailable(false);
    client.voice.status(conversationId)
      .then(status => { if (active) setVoiceAvailable(status.available); })
      .catch(() => { if (active) setVoiceAvailable(false); });
    return () => { active = false; };
  }, [conversationId]);

  useEffect(() => {
    if (!delegationStatus || DELEGATION_ACTIVE_STATUSES.has(delegationStatus)) return;
    void loadMessages({ preserveHistory: true });
  }, [delegationStatus, loadMessages]);

  useEffect(() => {
    onActivityChange?.(conversationId, isLoading ? activity : null);
  }, [activity, conversationId, isLoading, onActivityChange]);

  useEffect(() => {
    if (isVisible) return;
    handsFreeModeRef.current = false;
    setHandsFreeMode(false);
    setHandsFreeStatus('off');
    stopVoiceCapture(false);
    stopVoicePlayback({ discard: true });
  }, [isVisible]);

  useEffect(() => {
    handsFreeModeRef.current = false;
    setHandsFreeMode(false);
    setHandsFreeStatus('off');
    stopVoiceCapture(false);
    stopVoicePlayback({ discard: true });
  }, [conversationId]);

  useEffect(() => () => {
    abortRef.current?.abort();
    voiceSynthesisIdRef.current++;
    const session = voiceSessionRef.current;
    if (session) {
      window.clearTimeout(session.finishTimer);
      window.clearTimeout(session.transcriptionTimer);
      session.channel.close();
      session.pc.close();
      session.stream.getTracks().forEach(track => track.stop());
    }
    voiceAudioRef.current?.pause();
    voiceAudioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !isVisible) return;
    if (scrollRestoreRef.current) {
      const { height, top } = scrollRestoreRef.current;
      container.scrollTop = top + (container.scrollHeight - height);
      scrollRestoreRef.current = null;
      shouldStickToBottomRef.current = false;
    } else if (shouldStickToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [isVisible, messages]);

  function handleMessagesScroll() {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    // Solo retomamos el seguimiento cuando el usuario vuelve realmente al final.
    shouldStickToBottomRef.current = distanceFromBottom <= BOTTOM_SCROLL_THRESHOLD;
    if (container.scrollTop <= 100) void loadOlderMessages();
  }

  async function handleSubmit(e, submittedText, fromVoice = false) {
    e?.preventDefault();
    const text = typeof submittedText === 'string' ? submittedText.trim() : input.trim();
    const editTarget = editingMessage;
    const selectedImages = fromVoice || editTarget ? [] : images;
    if ((!text && selectedImages.length === 0) || isLoading || pendingImageReads > 0 || DELEGATION_ACTIVE_STATUSES.has(delegationStatus)) return;
    if (editTarget) {
      const laterCount = messages.filter(message => !message.pending && isMessageAfter(message, editTarget)).length;
      const warning = `Al editar este mensaje se eliminarán ${laterCount} mensaje${laterCount === 1 ? '' : 's'} posterior${laterCount === 1 ? '' : 'es'} y se generará una respuesta nueva. No se puede deshacer. Los efectos externos de herramientas (por ejemplo, cambios en otros sistemas) no se revierten. ¿Querés continuar?`;
      if (!window.confirm(warning)) return;
    }

    let assistantResponseText = '';
    let assistantSpeechSegment = '';
    let streamFailure = '';
    let willSpeakVoiceReply = false;
    const voiceTraceId = fromVoice
      ? (globalThis.crypto?.randomUUID?.() ?? `voice-${Date.now()}-${Math.random().toString(16).slice(2)}`)
      : null;
    const voiceTurnStartedAt = Date.now();
    let firstVoiceTextLogged = false;
    if (fromVoice) {
      console.info('[voice-debug] turn-submitted', JSON.stringify({ traceId: voiceTraceId, textChars: text.length }));
    }
    const imageNote = selectedImages.length === 1
      ? '[Imagen adjunta; no almacenada]'
      : `[${selectedImages.length} imágenes adjuntas; no almacenadas]`;
    const persistedContent = selectedImages.length
      ? `${text}${text ? '\n\n' : ''}${imageNote}`
      : text;
    setInput('');
    if (editTarget) {
      setEditingMessage(null);
      inputBeforeEditRef.current = '';
    }
    replaceImages([]);
    setIsLoading(true);
    setActivity('thinking');
    setError(null);

    const userKey = `user-${Date.now()}`;
    const assistantKey = `assistant-${Date.now()}`;
    if (selectedImages.length) {
      imagePreviewsRef.current.push({ content: persistedContent, dataUrls: selectedImages.map(image => image.dataUrl) });
    }
    setMessages(prev => {
      const retained = editTarget
        ? prev.filter(message => !message.pending && isMessageBefore(message, editTarget))
        : prev;
      return [...retained, {
        id: userKey, conversationId, role: 'user', pending: true,
        content: persistedContent, imageDataUrls: selectedImages.map(image => image.dataUrl),
        toolName: null, toolArgs: null, toolResult: null,
        createdAt: new Date().toISOString(),
      }];
    });

    const handlers = {
      onTextDelta: (delta) => {
        if (fromVoice && !firstVoiceTextLogged) {
          firstVoiceTextLogged = true;
          console.info('[voice-debug] first-text-delta', JSON.stringify({
            traceId: voiceTraceId, msFromTurnSubmit: Date.now() - voiceTurnStartedAt,
          }));
        }
        assistantResponseText += delta;
        assistantSpeechSegment += delta;
        setActivity('responding');
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.id === assistantKey) {
            return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
          }
          return [...prev, {
            id: assistantKey, conversationId, role: 'assistant', pending: true,
            content: delta, toolName: null, toolArgs: null, toolResult: null,
            createdAt: new Date().toISOString(),
          }];
        });
      },
      onToolStart: (id, name) => {
        if (fromVoice && assistantSpeechSegment.trim()) {
          void enqueueVoiceSpeech(assistantSpeechSegment, voiceTraceId, voiceTurnStartedAt);
          assistantSpeechSegment = '';
        }
        setActivity('tool');
        setMessages(prev => [...prev, {
          id, conversationId, role: 'tool', status: 'running', pending: true,
          content: '', toolName: name, toolArgs: null, toolResult: null,
          createdAt: new Date().toISOString(),
        }]);
      },
      onToolDone: (id, name, output) => {
        setActivity('thinking');
        setMessages(prev => prev.map(m =>
          m.id === id ? { ...m, status: 'done', toolName: name, toolResult: output, content: formatToolOutput(output) } : m
        ));
      },
      onError: (msg) => {
        streamFailure = msg;
        setError(msg);
        setMessages(prev => prev.map(message =>
          message.role === 'tool' && message.status === 'running'
            ? { ...message, status: 'error' }
            : message
        ));
      },
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = editTarget
        ? await client.messages.edit(
          conversationId,
          editTarget.id,
          text,
          messages.filter(message => !message.pending && isMessageAfter(message, editTarget)).length,
          handlers,
          controller.signal,
        )
        : await client.messages.send(conversationId, text, handlers, controller.signal, {
          images: selectedImages.map(image => image.dataUrl),
        });
      if (result === 'ok' && !streamFailure) {
        if (fromVoice) {
          console.info('[voice-debug] assistant-stream-complete', JSON.stringify({
            traceId: voiceTraceId, msFromTurnSubmit: Date.now() - voiceTurnStartedAt,
            replyChars: assistantResponseText.length,
          }));
        }
        // Cerramos el turno del chat en cuanto termina el stream. La recarga del historial
        // y la síntesis de voz son tareas secundarias y no deben dejar «Respondiendo» activo.
        void loadMessages({ preserveHistory: true });
        void client.conversations.get(conversationId).then(conversation => {
          setConversationTitle(conversation.title ?? '');
          onConversationUpdated?.(conversation);
        }).catch(e => setError(e.message));
        if (fromVoice && assistantResponseText.trim()) {
          if (assistantSpeechSegment.trim()) {
            void enqueueVoiceSpeech(assistantSpeechSegment, voiceTraceId, voiceTurnStartedAt);
          }
          // La síntesis de los segmentos ya enviados sigue en segundo plano. La
          // captura manos libres se reanuda solo cuando se reproduzcan todos.
          speechSynthesisFinishedRef.current = true;
          willSpeakVoiceReply = handsFreeModeRef.current;
          if (voiceSynthesisPendingRef.current === 0) completeHandsFreeSpeechIfReady();
        } else if (fromVoice) {
          console.warn('[voice-debug] no-assistant-text', JSON.stringify({ traceId: voiceTraceId, result }));
        }
      } else {
        const reconciled = await loadMessages({ preserveHistory: true });
        if (!reconciled) setMessages(prev => prev.filter(message => !message.pending));
        setIsHistoryStale(!reconciled);
        setError(`${streamFailure ? `El asistente informó un error: ${streamFailure}.` : 'El turno se interrumpió.'} ${reconciled ? 'Se actualizó el historial; revisá si quedó una respuesta antes de volver a enviarlo.' : 'No se pudo actualizar el historial; usá «Actualizar historial» antes de volver a enviarlo.'} Las herramientas pueden haber aplicado efectos externos aunque no haya llegado una respuesta.`);
      }
    } catch (e) {
      const wasAborted = e.name === 'AbortError';
      if (editTarget) {
        setInput(text);
        setEditingMessage(null);
      }
      const reconciled = await loadMessages({ preserveHistory: true });
      if (!reconciled) setMessages(prev => prev.filter(message => !message.pending));
      setIsHistoryStale(!reconciled);
      setMessages(prev => prev.map(message =>
        message.role === 'tool' && message.status === 'running'
          ? { ...message, status: wasAborted ? 'cancelled' : 'error' }
          : message
      ));
      setError(`${wasAborted ? 'El turno se interrumpió.' : (e.message || 'Falló el envío del mensaje.')} ${reconciled ? 'Se actualizó el historial; revisá si quedó una respuesta antes de volver a enviarlo.' : 'No se pudo actualizar el historial; usá «Actualizar historial» antes de volver a enviarlo.'} Las herramientas pueden haber aplicado efectos externos aunque no haya llegado una respuesta.`);
    } finally {
      abortRef.current = null;
      setIsLoading(false);
      setActivity('idle');
      if (fromVoice && handsFreeModeRef.current && !willSpeakVoiceReply) {
        void restartHandsFreeCapture();
      }
    }
  }

  async function changeAgentProfile(event) {
    const nextId = event.target.value;
    if (!nextId || nextId === agentProfileId || isChangingProfile) return;
    setIsChangingProfile(true);
    setError(null);
    try {
      const conversation = await client.conversations.patch(conversationId, { agentProfileId: nextId });
      setAgentProfileId(conversation.agentProfileId ?? '');
      onConversationUpdated?.(conversation);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsChangingProfile(false);
    }
  }

  async function saveConversationTitle(e) {
    e.preventDefault();
    if (isSavingTitle) return;
    setIsSavingTitle(true);
    setError(null);
    try {
      const conversation = await client.conversations.patch(conversationId, { title: titleDraft });
      setConversationTitle(conversation.title ?? '');
      setTitleDraft(conversation.title ?? '');
      setIsEditingTitle(false);
      onConversationUpdated?.(conversation);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsSavingTitle(false);
    }
  }

  function startEditingTitle() {
    setTitleDraft(conversationTitle);
    setIsEditingTitle(true);
  }

  function cancelEditingTitle() {
    setTitleDraft(conversationTitle);
    setIsEditingTitle(false);
  }

  function stopVoicePlayback({ discard = false } = {}) {
    voicePlaybackEnabledRef.current = false;
    const audio = voiceAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      voiceAudioRef.current = null;
    }
    setIsPlayingVoice(false);
    if (discard) {
      // Invalida cualquier síntesis anterior que todavía esté en vuelo.
      voiceSynthesisIdRef.current++;
      voiceSynthesisPendingRef.current = 0;
      voiceSpeechPipelineRef.current = false;
      voicePlaybackIndexRef.current = 0;
      voiceAudioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      voiceAudioUrlsRef.current = [];
      voiceAudioUrlRef.current = null;
      setVoiceAudioUrl(null);
      setIsPreparingVoice(false);
    }
  }

  function completeHandsFreeSpeechIfReady() {
    if (!speechSynthesisFinishedRef.current || voiceSynthesisPendingRef.current > 0) return;
    if (voiceAudioRef.current || voicePlaybackIndexRef.current < voiceAudioUrlsRef.current.length) return;
    setIsPlayingVoice(false);
    voiceSpeechPipelineRef.current = false;
    if (handsFreeModeRef.current) void restartHandsFreeCapture();
  }

  function enqueueVoiceSpeech(rawText, turnTraceId, turnStartedAt) {
    const traceId = turnTraceId || (globalThis.crypto?.randomUUID?.() ?? `voice-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const text = rawText
      .replace(/```[\s\S]*?```/g, ' fragmento de código omitido ')
      .replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[`*_>#~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return;

    if (!voiceSpeechPipelineRef.current) {
      stopVoicePlayback({ discard: true });
      speechSynthesisFinishedRef.current = false;
      voiceSynthesisPendingRef.current = 0;
      voiceSynthesisQueueRef.current = Promise.resolve();
      voiceSpeechPipelineRef.current = true;
      voiceTraceIdRef.current = traceId;
      voicePlaybackEnabledRef.current = true;
      voicePlaybackIndexRef.current = 0;
      if (handsFreeModeRef.current) setHandsFreeStatus('processing');
    }

    const replyReadyAt = Date.now();
    const chunks = splitSpeechText(text, 600, 220);
    console.info('[voice-debug] reply-segment-ready', JSON.stringify({
      traceId, textChars: text.length, chunkCount: chunks.length,
      msFromTurnSubmit: turnStartedAt ? Date.now() - turnStartedAt : null,
    }));
    const synthesisId = voiceSynthesisIdRef.current;
    voiceSynthesisPendingRef.current++;
    setIsPreparingVoice(true);

    const synthesizeSegment = async () => {
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        if (synthesisId !== voiceSynthesisIdRef.current) return;
        const chunk = chunks[chunkIndex];
        const requestStartedAt = Date.now();
        console.info('[voice-debug] synthesis-start', JSON.stringify({
          traceId, chunkIndex: chunkIndex + 1, chunkCount: chunks.length, textChars: chunk.length,
        }));
        const slowRequestTimer = window.setTimeout(() => {
          console.warn('[voice-debug] synthesis-still-pending', JSON.stringify({
            traceId, chunkIndex: chunkIndex + 1, elapsedMs: Date.now() - requestStartedAt,
          }));
        }, 10_000);
        try {
          const blob = await client.voice.synthesize(conversationId, chunk, traceId);
          window.clearTimeout(slowRequestTimer);
          const synthesisMs = Date.now() - requestStartedAt;
          console.info('[voice-debug] synthesis-ready', JSON.stringify({
            traceId, chunkIndex: chunkIndex + 1, chunkCount: chunks.length,
            synthesisMs, audioBytes: blob.size,
          }));
          if (synthesisId !== voiceSynthesisIdRef.current) {
            console.info('[voice-debug] synthesis-discarded', JSON.stringify({ traceId, chunkIndex: chunkIndex + 1 }));
            return;
          }
          const urls = voiceAudioUrlsRef.current;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          voiceAudioUrlsRef.current = urls;
          if (urls.length === 1) {
            voiceAudioUrlRef.current = url;
            setVoiceAudioUrl(url);
            console.info('[voice-debug] first-audio-ready', JSON.stringify({
              traceId, msFromReplyReady: Date.now() - replyReadyAt,
              msFromTurnSubmit: turnStartedAt ? Date.now() - turnStartedAt : null, audioBytes: blob.size,
            }));
          }
          // Los segmentos se sintetizan en orden, pero la reproducción empieza
          // en cuanto llega el primer clip, mientras la herramienta/turno continúa.
          if (voicePlaybackEnabledRef.current && !voiceAudioRef.current && voicePlaybackIndexRef.current === urls.length - 1) {
            playVoiceTrack(voicePlaybackIndexRef.current);
          }
        } catch (e) {
          window.clearTimeout(slowRequestTimer);
          console.error('[voice-debug] synthesis-failed', JSON.stringify({
            traceId, chunkIndex: chunkIndex + 1, chunkCount: chunks.length,
            synthesisMs: Date.now() - requestStartedAt, error: e?.message || String(e),
          }));
          if (synthesisId === voiceSynthesisIdRef.current) {
            setError(`La respuesta quedó guardada, pero no se pudo generar el audio: ${e.message}`);
          }
          break;
        }
      }
    };

    voiceSynthesisQueueRef.current = voiceSynthesisQueueRef.current
      .catch(() => {})
      .then(synthesizeSegment)
      .finally(() => {
        if (synthesisId !== voiceSynthesisIdRef.current) return;
        voiceSynthesisPendingRef.current = Math.max(0, voiceSynthesisPendingRef.current - 1);
        if (voiceSynthesisPendingRef.current === 0) setIsPreparingVoice(false);
        completeHandsFreeSpeechIfReady();
      });
  }

  function playVoiceTrack(index) {
    const urls = voiceAudioUrlsRef.current;
    const traceId = voiceTraceIdRef.current;
    if (!urls[index]) {
      console.info('[voice-debug] playback-queue-empty', JSON.stringify({ traceId, chunkIndex: index + 1, readyChunks: urls.length }));
      voiceAudioRef.current = null;
      voicePlaybackIndexRef.current = index;
      setIsPlayingVoice(false);
      completeHandsFreeSpeechIfReady();
      return;
    }
    voicePlaybackIndexRef.current = index;
    console.info('[voice-debug] playback-start-request', JSON.stringify({ traceId, chunkIndex: index + 1, readyChunks: urls.length }));
    const audio = new Audio(urls[index]);
    voiceAudioRef.current = audio;
    audio.onplaying = () => {
      console.info('[voice-debug] playback-playing', JSON.stringify({ traceId, chunkIndex: index + 1 }));
      if (handsFreeModeRef.current) setHandsFreeStatus('speaking');
    };
    audio.onwaiting = () => {
      console.warn('[voice-debug] playback-waiting', JSON.stringify({ traceId, chunkIndex: index + 1, readyState: audio.readyState }));
    };
    audio.onstalled = () => {
      console.warn('[voice-debug] playback-stalled', JSON.stringify({ traceId, chunkIndex: index + 1, readyState: audio.readyState, networkState: audio.networkState }));
    };
    audio.onended = () => {
      console.info('[voice-debug] playback-ended', JSON.stringify({ traceId, chunkIndex: index + 1 }));
      if (voiceAudioRef.current === audio) {
        voiceAudioRef.current = null;
        if (voicePlaybackEnabledRef.current) playVoiceTrack(index + 1);
        else setIsPlayingVoice(false);
      }
    };
    audio.onerror = () => {
      console.error('[voice-debug] playback-error', JSON.stringify({
        traceId, chunkIndex: index + 1, mediaErrorCode: audio.error?.code ?? null,
        readyState: audio.readyState, networkState: audio.networkState,
      }));
      if (voiceAudioRef.current === audio) {
        voiceAudioRef.current = null;
        voicePlaybackEnabledRef.current = false;
        voicePlaybackIndexRef.current = voiceAudioUrlsRef.current.length;
        setIsPlayingVoice(false);
        setError('No se pudo reproducir la respuesta de voz. Podés intentar reproducirla de nuevo.');
        completeHandsFreeSpeechIfReady();
      }
    };
    setIsPlayingVoice(true);
    void audio.play().catch(e => {
      console.error('[voice-debug] playback-rejected', JSON.stringify({
        traceId, chunkIndex: index + 1, errorName: e?.name || null, error: e?.message || String(e),
      }));
      if (voiceAudioRef.current === audio) {
        voiceAudioRef.current = null;
        voicePlaybackEnabledRef.current = false;
        voicePlaybackIndexRef.current = voiceAudioUrlsRef.current.length;
        setIsPlayingVoice(false);
        const message = e?.name === 'NotAllowedError'
          ? 'El navegador bloqueó la reproducción automática. Tocá «Reproducir voz» para escuchar la respuesta.'
          : `No se pudo iniciar la reproducción de voz: ${e.message}`;
        setError(message);
        completeHandsFreeSpeechIfReady();
      }
    });
  }

  function finishVoiceCapture(session, submitTranscript) {
    if (session?.finished) return;
    const continueHandsFree = Boolean(session?.handsFree && handsFreeModeRef.current);
    if (session) {
      session.finished = true;
      window.clearTimeout(session.finishTimer);
      window.clearTimeout(session.transcriptionTimer);
      if (voiceSessionRef.current === session) voiceSessionRef.current = null;
      session.channel.close();
      session.pc.close();
      session.stream.getTracks().forEach(track => track.stop());
    }
    setVoiceState('idle');
    if (continueHandsFree) setHandsFreeStatus('processing');
    const text = voiceTranscriptRef.current.join(' ').replace(/\s+/g, ' ').trim();
    voiceTranscriptRef.current = [];
    if (submitTranscript && text) void handleSubmit(null, text, true);
    else if (submitTranscript && !continueHandsFree) setError(session?.errorMessage || 'No se reconoció voz. Probá de nuevo o escribí el mensaje.');
    else if (continueHandsFree) void restartHandsFreeCapture();
  }

  function stopVoiceCapture(submitTranscript = true) {
    voiceStartIdRef.current++;
    const session = voiceSessionRef.current;
    if (!session) {
      voiceTranscriptRef.current = [];
      setVoiceState('idle');
      if (submitTranscript) setError('No se reconoció voz. Probá de nuevo o escribí el mensaje.');
      return;
    }
    if (!submitTranscript) {
      voiceTranscriptRef.current = [];
      finishVoiceCapture(session, false);
      return;
    }
    if (session.stopRequested) return;
    // Detener la pista avisa al servidor que terminó el audio. Mantenemos el
    // canal de eventos abierto para que llegue la transcripción final.
    session.stopRequested = true;
    setVoiceState('transcribing');
    session.stream.getTracks().forEach(track => track.stop());
    session.finishTimer = window.setTimeout(() => finishVoiceCapture(session, true), 5000);
  }

  function handleTranscriptionEvent(session, transcript) {
    if (typeof transcript === 'string' && transcript.trim()) {
      voiceTranscriptRef.current.push(transcript.trim());
    }
    if (session.handsFree && handsFreeModeRef.current) {
      session.stopRequested = true;
      session.stream.getTracks().forEach(track => track.stop());
      finishVoiceCapture(session, true);
    } else if (session.stopRequested) {
      // Puede haber más de un segmento de transcripción en camino; dejamos que
      // termine de llegar el lote antes de cerrar el canal.
      window.clearTimeout(session.transcriptionTimer);
      session.transcriptionTimer = window.setTimeout(() => finishVoiceCapture(session, true), 500);
    }
  }

  function handleVoiceError(session, message) {
    session.errorMessage = message || 'Falló el reconocimiento de voz.';
    if (session.stopRequested) finishVoiceCapture(session, true);
    else {
      setError(session.errorMessage);
      if (session.handsFree) disableHandsFree();
    }
  }

  async function startVoiceCapture(handsFree = false) {
    const startId = ++voiceStartIdRef.current;
    let pendingStream = null;
    setError(null);
    stopVoicePlayback();
    voiceTranscriptRef.current = [];
    setVoiceState('connecting');
    if (handsFree) setHandsFreeStatus('connecting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
        throw new Error('Este navegador no admite captura de voz WebRTC.');
      }
      const token = await client.voice.createRealtimeToken(conversationId);
      if (startId !== voiceStartIdRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      pendingStream = stream;
      if (startId !== voiceStartIdRef.current) {
        stream.getTracks().forEach(track => track.stop());
        pendingStream = null;
        return;
      }
      const pc = new RTCPeerConnection();
      const channel = pc.createDataChannel('oai-events');
      const session = { pc, channel, stream, handsFree, stopRequested: false, finished: false, finishTimer: null, transcriptionTimer: null };
      pendingStream = null;
      voiceSessionRef.current = session;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      channel.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'input_audio_buffer.speech_stopped' && session.handsFree && !session.stopRequested) {
          session.stopRequested = true;
          setHandsFreeStatus('processing');
          session.stream.getTracks().forEach(track => track.stop());
          session.finishTimer = window.setTimeout(() => finishVoiceCapture(session, true), 5000);
        } else if (message.type === 'conversation.item.input_audio_transcription.completed') {
          handleTranscriptionEvent(session, message.transcript);
        } else if (message.type === 'error') {
          handleVoiceError(session, message.error?.message);
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' && voiceSessionRef.current === session) {
          setError('Se perdió la conexión de voz. Probá nuevamente.');
          if (session.handsFree) disableHandsFree();
          else stopVoiceCapture(false);
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/sdp' },
        body: pc.localDescription?.sdp,
      });
      if (!answer.ok) throw new Error(`OpenAI rechazó la conexión de voz (HTTP ${answer.status}).`);
      await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
      if (startId === voiceStartIdRef.current) {
        setVoiceState('listening');
        if (handsFree) setHandsFreeStatus('listening');
      }
    } catch (e) {
      pendingStream?.getTracks().forEach(track => track.stop());
      if (startId !== voiceStartIdRef.current) return;
      if (handsFree) disableHandsFree();
      else stopVoiceCapture(false);
      setError(e.message || 'No se pudo iniciar el reconocimiento de voz.');
    }
  }

  async function restartHandsFreeCapture() {
    if (!handsFreeModeRef.current || handsFreeRestartRef.current) return;
    handsFreeRestartRef.current = true;
    try {
      await startVoiceCapture(true);
    } finally {
      handsFreeRestartRef.current = false;
    }
  }

  function disableHandsFree() {
    handsFreeModeRef.current = false;
    setHandsFreeMode(false);
    setHandsFreeStatus('off');
    if (voiceSessionRef.current) stopVoiceCapture(false);
    else voiceStartIdRef.current++;
    stopVoicePlayback({ discard: true });
  }

  function toggleHandsFree() {
    if (handsFreeModeRef.current) {
      disableHandsFree();
      return;
    }
    if (isLoading || isDelegatedActive || editingMessage || voiceState !== 'idle') return;
    handsFreeModeRef.current = true;
    setHandsFreeMode(true);
    setHandsFreeStatus('connecting');
    void startVoiceCapture(true);
  }

  function handleVoiceButton() {
    if (voiceState === 'transcribing') return;
    if (voiceState === 'connecting') {
      stopVoiceCapture(false);
      setError(null);
    } else if (voiceState === 'listening') {
      stopVoiceCapture(true);
    } else {
      void startVoiceCapture();
    }
  }

  function handleReplayVoice() {
    if (!voiceAudioUrlsRef.current.length) return;
    setError(null);
    stopVoicePlayback();
    voicePlaybackEnabledRef.current = true;
    playVoiceTrack(0);
  }

  function handleAbort() {
    setMessages(prev => prev.map(message =>
      message.role === 'tool' && message.status === 'running'
        ? { ...message, status: 'cancelled' }
        : message
    ));
    abortRef.current?.abort();
  }

  async function retryHistoryLoad() {
    const loaded = await loadMessages({ preserveHistory: true });
    if (loaded) {
      setIsHistoryStale(false);
      setError(null);
    }
  }

  const isDelegatedActive = DELEGATION_ACTIVE_STATUSES.has(delegationStatus);

  return (
    <main className="chat-area">
      <header className="chat-header">
        <button className="mobile-menu-button" type="button" onClick={onOpenSidebar} aria-label="Abrir conversaciones" title="Abrir conversaciones"><Icon name="menu" /></button>
        <div className="conversation-heading">
          {isEditingTitle ? (
            <form className="conversation-title-form" onSubmit={saveConversationTitle}>
              <input
                autoFocus
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') cancelEditingTitle(); }}
                maxLength={200}
                required
                placeholder="Título de la conversación"
                aria-label="Título de la conversación"
                disabled={isSavingTitle}
              />
              <button type="submit" className="title-control title-icon-button" disabled={isSavingTitle || !titleDraft.trim()} title="Guardar título" aria-label="Guardar título"><Icon name="save" /></button>
              <button type="button" className="title-control title-icon-button" onClick={cancelEditingTitle} disabled={isSavingTitle} title="Cancelar edición" aria-label="Cancelar edición"><Icon name="close" /></button>
            </form>
          ) : (
            <>
              <span className="conversation-title" title={conversationTitle || 'Sin título'}>{conversationTitle || 'Sin título'}</span>
              <button type="button" className="title-edit-button title-icon-button" onClick={startEditingTitle} title="Cambiar título de la conversación" aria-label="Cambiar título de la conversación"><Icon name="edit" /></button>
            </>
          )}
          <span className="conversation-id" title={`ID: ${conversationId}`}>ID: {conversationId}</span>
          {agentProfiles.length > 0 && (
            <label className="chat-profile-picker" title="Perfil usado en los próximos turnos">
              Agente
              <select value={agentProfileId} onChange={changeAgentProfile} disabled={isChangingProfile || isLoading}>
                {!agentProfiles.some(profile => profile.id === agentProfileId) && agentProfileId && <option value={agentProfileId}>Perfil archivado</option>}
                {agentProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <span className="header-spacer" />
        <div className="toolbar">
          {isPreparingVoice && <span role="status">Preparando audio…</span>}
          {voiceAudioUrl && !handsFreeMode && (
            <button type="button" onClick={isPlayingVoice ? () => stopVoicePlayback() : handleReplayVoice} title={isPlayingVoice ? 'Detener la respuesta hablada' : 'Reproducir la última respuesta hablada'}>
              {isPlayingVoice ? 'Detener voz' : 'Reproducir voz'}
            </button>
          )}
          <button className="reload-button" onClick={() => loadMessages({ preserveHistory: true })} disabled={isLoading} title="Actualizar los mensajes" aria-label="Actualizar los mensajes"><Icon name="refresh" /><span>Recargar</span></button>
        </div>
      </header>
      <div
        ref={scrollContainerRef}
        className="messages"
        onScroll={handleMessagesScroll}
      >
        {isLoadingOlder && <div className="history-loading" role="status">Cargando mensajes anteriores…</div>}
        {renderMessageList(messages, onOpenConversation, !isLoading && !isDelegatedActive && !handsFreeMode && voiceState === 'idle' && images.length === 0 ? startEditingMessage : null)}
        {isLoading && (
          <div className="thinking-slot">
            {activity === 'thinking' && <ThinkingIndicator />}
          </div>
        )}
      </div>
      {error && (
        <div className="error-bar" role="alert">
          <span>{error}</span>
          {isHistoryStale && <button type="button" className="error-retry-button" onClick={retryHistoryLoad}>Actualizar historial</button>}
        </div>
      )}
      <form onSubmit={handleSubmit} className="composer">
        {editingMessage && (
          <div className="message-edit-notice" role="status">
            <div>
              <strong>Editando mensaje</strong>
              <span>Al reenviar se reemplazará y se eliminarán las respuestas posteriores.</span>
            </div>
            <button type="button" className="message-edit-cancel" onClick={cancelEditingMessage} disabled={isLoading}>Cancelar</button>
          </div>
        )}
        {images.length > 0 && (
          <div className="image-attachments-preview">
            {images.map((image, index) => (
              <div className="image-attachment-preview" key={`${image.name}-${index}`}>
                <img src={image.dataUrl} alt={`Vista previa: ${image.name}`} />
                <div className="image-attachment-details">
                  <span className="attachment-type">Imagen {index + 1}</span>
                  <span className="attachment-name" title={image.name}>{image.name}</span>
                  <small>No se guardará en el historial</small>
                </div>
                <button type="button" onClick={() => replaceImages(current => current.filter((_, imageIndex) => imageIndex !== index))} disabled={isLoading} aria-label={`Quitar ${image.name}`} title="Quitar imagen"><Icon name="close" /></button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={imageFileInputRef}
          className="attachment-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={handleImageSelection}
          tabIndex={-1}
          aria-hidden="true"
        />
        {voiceAvailable && <div className="hands-free-control">
          <button
            type="button"
            className={`hands-free-button${handsFreeMode ? ' hands-free-active' : ''}`}
            onClick={toggleHandsFree}
            disabled={!handsFreeMode && (isLoading || isDelegatedActive || Boolean(editingMessage) || voiceState !== 'idle')}
            aria-pressed={handsFreeMode}
            title={handsFreeMode ? 'Salir del modo manos libres y apagar el micrófono' : 'Activar conversación por voz sin tener que apretar para hablar'}
          >
            {handsFreeMode ? '■ Salir de manos libres' : '🎙 Manos libres'}
          </button>
          {handsFreeMode && <span className={`hands-free-status hands-free-status-${handsFreeStatus}`} role="status" aria-live="polite">
            <span className="hands-free-status-dot" aria-hidden="true" />
            {handsFreeStatus === 'connecting' ? 'Conectando al micrófono…'
              : handsFreeStatus === 'listening' ? 'Escuchando. Hablá cuando quieras.'
                : handsFreeStatus === 'processing' ? 'Procesando tu mensaje…'
                  : handsFreeStatus === 'speaking' ? 'El asistente está hablando…'
                    : 'Modo manos libres'}
          </span>}
        </div>}
        <div className="composer-row">
          <div className="attachment-menu-wrap" ref={attachmentMenuRef}>
            <button
              type="button"
              className="attach-button"
              disabled={isLoading || isDelegatedActive || Boolean(editingMessage) || handsFreeMode}
              aria-haspopup="menu"
              aria-expanded={isAttachMenuOpen}
              title="Adjuntar un archivo"
              onClick={() => setIsAttachMenuOpen(open => !open)}
            >
              <Icon name="attach" />
              Adjuntar{images.length > 0 ? ` (${images.length}/${MAX_IMAGES})` : ''}
            </button>
            {isAttachMenuOpen && (
              <div className="attachment-menu" role="menu" aria-label="Tipo de archivo">
                <button type="button" role="menuitem" title="Adjuntar una imagen" onClick={() => imageFileInputRef.current?.click()}>
                  <Icon name="image" className="attachment-menu-icon" />
                  <span>Imagen</span>
                </button>
              </div>
            )}
          </div>
          {voiceAvailable && !handsFreeMode && <button
            className={`voice-button${voiceState === 'listening' ? ' voice-listening' : ''}`}
            type="button"
            onClick={handleVoiceButton}
            disabled={isLoading || isDelegatedActive || Boolean(editingMessage) || voiceState === 'transcribing'}
            title={voiceState === 'idle' ? 'Hablar por voz' : voiceState === 'connecting' ? 'Conectando con reconocimiento de voz' : voiceState === 'transcribing' ? 'Esperando la transcripción de voz' : 'Terminar de hablar y enviar'}
            aria-label={voiceState === 'idle' ? 'Hablar por voz' : voiceState === 'connecting' ? 'Conectando con reconocimiento de voz' : voiceState === 'transcribing' ? 'Procesando voz' : 'Terminar de hablar y enviar'}
          >
            {voiceState === 'idle' ? '🎙 Hablar' : voiceState === 'connecting' ? 'Conectando…' : voiceState === 'transcribing' ? 'Procesando…' : 'Enviar voz'}
          </button>}
          {voiceAvailable && !handsFreeMode && voiceState !== 'idle' && <button
            className="voice-cancel-button"
            type="button"
            onClick={() => {
              stopVoiceCapture(false);
              setError(null);
            }}
            title="Cancelar y descartar la grabación de voz"
            aria-label="Cancelar y descartar la grabación de voz"
          >
            Cancelar
          </button>}
          <textarea
            ref={messageInputRef}
            className="message-input"
            value={input}
            onChange={handleInputChange}
            onPaste={handleInputPaste}
            onKeyDown={handleInputKeyDown}
            placeholder={editingMessage ? 'Editá el mensaje y reenviá...' : 'Escribí un mensaje...'}
            disabled={isLoading || isDelegatedActive || handsFreeMode}
            maxLength={MAX_MESSAGE_CHARS}
            rows={1}
            aria-label="Mensaje"
          />
          <button className="send-button" type="submit" disabled={isLoading || isDelegatedActive || handsFreeMode || (!input.trim() && images.length === 0)} title={editingMessage ? 'Guardar la edición y generar una respuesta nueva' : 'Enviar mensaje'} aria-label={editingMessage ? 'Guardar y reenviar mensaje editado' : 'Enviar mensaje'}><Icon name="send" /><span>{editingMessage ? 'Guardar y reenviar' : 'Enviar'}</span></button>
          <button className="stop-button" type="button" disabled={!isLoading} onClick={handleAbort} title="Detener la respuesta" aria-label="Detener la respuesta"><Icon name="stop" /><span>Parar</span></button>
        </div>
        <small className="message-length" aria-label="Longitud del mensaje">
          {handsFreeMode
            ? 'La escucha se pausa mientras responde el asistente y se reanuda al terminar. Salí del modo para apagar el micrófono.'
            : voiceState === 'listening'
              ? 'Escuchando. Tocá «Enviar voz» para enviar o «Cancelar» para descartarla.'
              : voiceState === 'connecting'
                ? 'Conectando con el reconocimiento de voz… Tocá «Cancelar» para salir.'
                : voiceState === 'transcribing'
                  ? 'Procesando la transcripción… Podés cancelarla antes de que se envíe.'
                  : `${input.length.toLocaleString('es-AR')} / ${MAX_MESSAGE_CHARS.toLocaleString('es-AR')} caracteres · el límite de contexto del modelo también aplica`}
        </small>
      </form>
    </main>
  );
}

function ThinkingIndicator() {
  return (
    <div className="bubble assistant thinking-indicator" role="status" aria-label="El asistente está pensando">
      <span>Pensando</span> <ActivityDots />
    </div>
  );
}

function ActivityDots() {
  return (
    <span className="activity-dots" aria-hidden="true">
      <span>.</span><span>.</span><span>.</span>
    </span>
  );
}

function renderMessageList(messages, onOpenConversation, onEditMessage) {
  const rendered = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (!isStackableTool(message)) {
      rendered.push(<MessageBubble key={message.id} message={message} onOpenConversation={onOpenConversation} onEditMessage={onEditMessage} />);
      index++;
      continue;
    }

    const stack = [message];
    index++;
    while (index < messages.length && isStackableTool(messages[index])) {
      stack.push(messages[index]);
      index++;
    }

    rendered.push(stack.length > 1
      ? <ToolStack key={`tool-stack-${stack[0].id}`} messages={stack} onOpenConversation={onOpenConversation} onEditMessage={onEditMessage} />
      : <MessageBubble key={stack[0].id} message={stack[0]} onOpenConversation={onOpenConversation} onEditMessage={onEditMessage} />);
  }

  return rendered;
}

function isStackableTool(message) {
  return message?.role === 'tool';
}

function ToolStack({ messages, onOpenConversation, onEditMessage }) {
  const names = [...new Set(messages.map(message => message.toolName || 'Herramienta'))];
  const nameSummary = names.slice(0, 3).join(', ');
  const remainingNames = names.length - 3;
  const runningCount = messages.filter(message => message.status === 'running').length;
  const errorCount = messages.filter(message => message.status === 'error').length;

  return (
    <details className="tool-stack">
      <summary className="tool-stack-summary">
        <span className="tool-stack-count">{messages.length} llamadas</span>
        <span className="tool-stack-names">{nameSummary}{remainingNames > 0 ? ` y ${remainingNames} más` : ''}</span>
        {runningCount > 0 && <span className="tool-stack-status"><span className="tool-spinner" />{runningCount} ejecutando</span>}
        {errorCount > 0 && <span className="tool-stack-status tool-status-error">{errorCount} con error</span>}
      </summary>
      <div className="tool-stack-items">
        {messages.map(message => <MessageBubble key={message.id} message={message} onOpenConversation={onOpenConversation} onEditMessage={onEditMessage} />)}
      </div>
    </details>
  );
}

function MessageBubble({ message, onOpenConversation, onEditMessage }) {
  if (message.role === 'tool') {
    const delegation = message.toolName === 'delegate_to_conversation' ? parseDelegation(message.toolResult) : null;
    if (delegation) return <DelegationCard delegation={delegation} onOpenConversation={onOpenConversation} />;
    const output = formatToolOutput(message.toolResult ?? message.content, message.toolName);
    const outputLines = output ? output.split('\n').length : 0;
    return (
      <div className={`bubble tool ${message.status === 'running' ? 'tool-running' : ''}`}>
        <div className="tool-heading">
          <span className="tool-name">{message.toolName || 'Herramienta'}</span>
          {message.status === 'running' && <span className="tool-status"><span className="tool-spinner" />Ejecutando <ActivityDots /></span>}
          {message.status === 'cancelled' && <span className="tool-status">Cancelada</span>}
          {message.status === 'error' && <span className="tool-status tool-status-error">Error</span>}
        </div>
        {message.status === 'running'
          ? <div className="tool-result tool-pending">Esperando respuesta…</div>
          : output && (
            <details className="tool-output-details">
              <summary>Resultado · {outputLines} {outputLines === 1 ? 'línea' : 'líneas'}</summary>
              <pre className="tool-result">{truncate(output, 12000)}</pre>
            </details>
          )}
      </div>
    );
  }
  return (
    <div className={`bubble ${message.role}`}>
      <MarkdownContent content={message.content} preserveWhitespace={message.role === 'user'} />
      {(message.imageDataUrls ?? (message.imageDataUrl ? [message.imageDataUrl] : [])).map((imageDataUrl, index) => (
        <img className="message-image" src={imageDataUrl} alt={`Imagen adjunta ${index + 1}`} key={`${message.id}-image-${index}`} />
      ))}
      {message.role === 'user' && !message.pending && onEditMessage && !hasUnstoredImage(message) && (
        <div className="message-actions">
          <button type="button" className="message-edit-button" onClick={() => onEditMessage(message)} title="Editar y regenerar desde este mensaje" aria-label="Editar mensaje">
            <Icon name="edit" />
            <span>Editar</span>
          </button>
        </div>
      )}
    </div>
  );
}

function MarkdownContent({ content, preserveWhitespace = false }) {
  return <div className="markdown-content">{renderMarkdownBlocks(content || '', preserveWhitespace)}</div>;
}

function renderMarkdownBlocks(content, preserveWhitespace = false) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }

    const fence = line.match(/^\s*```([^`]*)\s*$/);
    if (fence) {
      const code = [];
      index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre className="markdown-code" key={`code-${index}`}><code>{code.join('\n')}</code></pre>);
      continue;
    }

    if (index + 1 < lines.length && isMarkdownTableRow(line) && isMarkdownTableSeparator(lines[index + 1])) {
      const headers = splitMarkdownTableRow(line);
      const alignments = splitMarkdownTableRow(lines[index + 1]).map(getMarkdownTableAlignment);
      const rows = [];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index]) && lines[index].trim()) {
        rows.push(splitMarkdownTableRow(lines[index++]));
      }
      blocks.push(
        <div className="markdown-table-wrapper" key={`table-${index}`}>
          <table className="markdown-table">
            <thead><tr>{headers.map((cell, cellIndex) => (
              <th key={cellIndex} scope="col" style={{ textAlign: alignments[cellIndex] || 'left' }}><MarkdownInline text={cell} /></th>
            ))}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{headers.map((_, cellIndex) => (
                <td key={cellIndex} style={{ textAlign: alignments[cellIndex] || 'left' }}><MarkdownInline text={row[cellIndex] || ''} /></td>
              ))}</tr>
            ))}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const Tag = `h${heading[1].length}`;
      blocks.push(<Tag key={`heading-${index}`}><MarkdownInline text={heading[2]} /></Tag>);
      index++;
      continue;
    }

    if (/^\s{0,3}(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />);
      index++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={`quote-${index}`}>{renderMarkdownBlocks(quote.join('\n'), preserveWhitespace)}</blockquote>);
      continue;
    }

    const listMatch = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(item[3]);
        index++;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}><MarkdownInline text={item} /></li>)}</Tag>);
      continue;
    }

    const paragraph = [preserveWhitespace ? line : line.trim()];
    index++;
    while (index < lines.length && lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !/^\s{0,3}#{1,6}\s+/.test(lines[index]) &&
      !/^\s*>/.test(lines[index]) &&
      !/^\s*(?:[-+*]|\d+\.)\s+/.test(lines[index]) &&
      !/^\s{0,3}(?:---+|___+|\*\*\*+)\s*$/.test(lines[index])) {
      paragraph.push(preserveWhitespace ? lines[index] : lines[index].trim());
      index++;
    }
    blocks.push(<p key={`paragraph-${index}`}><MarkdownInline text={paragraph.join(preserveWhitespace ? '\n' : ' ')} /></p>);
  }

  return blocks;
}

function splitMarkdownTableRow(line) {
  const cells = [];
  let cell = '';
  const trimmed = line.trim();
  const hasOuterLeadingPipe = trimmed.startsWith('|');
  const trailingBackslashes = (trimmed.match(/\\+$/) || [''])[0].length;
  const hasOuterTrailingPipe = trimmed.endsWith('|') && trailingBackslashes % 2 === 0;
  const start = hasOuterLeadingPipe ? 1 : 0;
  const end = hasOuterTrailingPipe ? trimmed.length - 1 : trimmed.length;

  for (let index = start; index < end; index++) {
    const character = trimmed[index];
    if (character === '\\' && trimmed[index + 1] === '|') {
      cell += '|';
      index++;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isMarkdownTableRow(line) {
  return splitMarkdownTableRow(line).length > 1;
}

function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function getMarkdownTableAlignment(separator) {
  if (separator.startsWith(':') && separator.endsWith(':')) return 'center';
  if (separator.endsWith(':')) return 'right';
  return 'left';
}

function MarkdownInline({ text }) {
  const tokenPattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\n]+\*|_[^_\n]+_)/g;
  const parts = text.split(tokenPattern).filter(Boolean);
  return parts.map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const safeHref = /^(https?:|mailto:)/i.test(link[2]) ? link[2] : null;
      return safeHref
        ? <a key={index} href={safeHref} target="_blank" rel="noreferrer">{link[1]}</a>
        : <span key={index}>{link[1]}</span>;
    }
    if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('***')) return <strong key={index}><em>{part.slice(3, -3)}</em></strong>;
    if (part.startsWith('**') || part.startsWith('__')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('~~')) return <del key={index}>{part.slice(2, -2)}</del>;
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <span key={index}>{part}</span>;
  });
}

function parseDelegation(value, depth = 0) {
  if (depth > 4 || value == null) return null;
  let record = value;
  if (typeof record === 'string') {
    try { record = JSON.parse(record); } catch { return null; }
  }
  if (!record || typeof record !== 'object') return null;
  if (Array.isArray(record)) {
    for (const item of record) {
      const found = parseDelegation(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof record.delegationId === 'string' && typeof record.targetConversationId === 'string') {
    return { id: record.delegationId, targetConversationId: record.targetConversationId };
  }
  if (typeof record.text === 'string') return parseDelegation(record.text, depth + 1);
  if (typeof record.content === 'string' || Array.isArray(record.content)) return parseDelegation(record.content, depth + 1);
  return null;
}

const TERMINAL_DELEGATION_STATUSES = new Set(['completed', 'failed', 'interrupted']);
const DELEGATION_STATUS_LABELS = {
  queued: 'En cola', running: 'En curso', completed: 'Completada', failed: 'Fallida', interrupted: 'Interrumpida',
};
const DELEGATION_EVENT_LABELS = {
  queued: 'Trabajo agregado a la cola', started: 'El agente destinatario empezó a trabajar',
  completed: 'El trabajo terminó correctamente', failed: 'El trabajo terminó con error',
  interrupted: 'El worker se interrumpió; el trabajo no se reintentará',
};

function DelegationCard({ delegation, onOpenConversation }) {
  const [status, setStatus] = useState('queued');
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let cursor = '0';
    const pause = () => new Promise(resolve => setTimeout(resolve, 1500));
    const updateStatus = async () => {
      const current = await client.delegations.get(delegation.id);
      if (active) {
        setStatus(current.status);
        setError(null);
      }
      return current.status;
    };

    async function follow() {
      while (active) {
        try {
          await updateStatus();
          await client.delegations.events(delegation.id, {
            after: cursor,
            signal: controller.signal,
            onEvent: event => {
              if (!active) return;
              if (event.id) cursor = event.id;
              setEvents(current => [...current, event].slice(-8));
              if (TERMINAL_DELEGATION_STATUSES.has(event.type)) setStatus(event.type);
            },
          });
          if (active && TERMINAL_DELEGATION_STATUSES.has(await updateStatus())) return;
        } catch (e) {
          if (!active || e.name === 'AbortError') return;
          setError(e.message || 'No se pudieron actualizar los eventos.');
        }
        if (active) await pause();
      }
    }

    void follow();
    return () => { active = false; controller.abort(); };
  }, [delegation.id]);

  const targetId = delegation.targetConversationId;
  return (
    <section className="delegation-card" aria-label="Seguimiento de delegación">
      <div className="delegation-heading">
        <strong>Delegación al otro hilo</strong>
        <span className={`delegation-status delegation-status-${status}`} role="status">
          {status === 'running' && <span className="tool-spinner" />}
          {DELEGATION_STATUS_LABELS[status] ?? status}
        </span>
      </div>
      <div className="delegation-meta">ID: <code>{delegation.id}</code></div>
      {events.length > 0 && (
        <ol className="delegation-events" aria-label="Eventos de la delegación">
          {events.map((event, index) => (
            <li key={event.id || `${event.type}-${index}`}>
              <span className="delegation-event-dot" />
              <span>{DELEGATION_EVENT_LABELS[event.type] ?? `Evento: ${event.type}`}</span>
            </li>
          ))}
        </ol>
      )}
      {status === 'completed' && <p className="delegation-note">El resultado quedó guardado en la conversación de destino.</p>}
      {status === 'interrupted' && <p className="delegation-note">El trabajo se detuvo por una interrupción y no se volverá a ejecutar automáticamente.</p>}
      {status === 'failed' && <p className="delegation-note">El trabajo no pudo completarse.</p>}
      {error && <p className="delegation-error">{error} Se volverá a intentar la conexión.</p>}
      <button type="button" className="delegation-open-button" onClick={() => onOpenConversation?.(targetId)}>
        Abrir conversación de destino
      </button>
    </section>
  );
}

function formatToolOutput(value, toolName, depth = 0) {
  if (value == null) return '';
  if (depth > 5) return String(value);

  if (typeof value === 'string') {
    let text = value.trim();
    // Los mensajes antiguos guardan `nombre → JSON` en content en lugar del resultado puro.
    if (toolName && text.startsWith(`${toolName} →`)) {
      text = text.slice(toolName.length + 2).trim();
    }
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return formatToolOutput(JSON.parse(text), toolName, depth + 1);
      } catch {
        // No era JSON: conservamos el texto legible tal cual.
      }
    }
    return text;
  }
  if (typeof value !== 'object') return String(value);

  // Las respuestas MCP envuelven la salida en bloques content[]. Desanidamos también
  // texto que haya sido serializado como JSON para evitar mostrar `\\n` literalmente.
  if (Array.isArray(value.content)) {
    const texts = value.content
      .filter(block => block && typeof block.text === 'string')
      .map(block => formatToolOutput(block.text, toolName, depth + 1));
    if (texts.length) return texts.join('\n');
  }
  if (typeof value.content === 'string' && Object.keys(value).every(key => ['content', 'isError'].includes(key))) {
    return formatToolOutput(value.content, toolName, depth + 1);
  }
  if (typeof value.text === 'string' && Object.keys(value).every(key => ['type', 'text'].includes(key))) {
    return formatToolOutput(value.text, toolName, depth + 1);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[Resultado no disponible]';
  }
}

function splitSpeechText(text, maxLength, firstChunkMaxLength = maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > (chunks.length === 0 ? firstChunkMaxLength : maxLength)) {
    const limit = chunks.length === 0 ? firstChunkMaxLength : maxLength;
    let cut = remaining.lastIndexOf('. ', limit);
    if (cut >= limit * 0.55) {
      cut += 1;
    } else {
      cut = remaining.lastIndexOf(' ', limit);
    }
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
