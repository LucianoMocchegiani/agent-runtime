import { useEffect, useRef, useState } from 'react';
import client from './client.js';

export const DELEGATION_ACTIVE_STATUSES = new Set(['queued', 'running']);

function compareMessageOrder(a, b) {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function isMessageAfter(message, target) {
  return compareMessageOrder(message, target) > 0;
}

function isMessageBefore(message, target) {
  return compareMessageOrder(message, target) < 0;
}

export default function useChatTurn({
  conversationId,
  delegationStatus,
  messages,
  setMessages,
  loadMessages,
  setIsHistoryStale,
  refreshConversation,
  setError,
  input,
  setInput,
  editingMessage,
  setEditingMessage,
  inputBeforeEditRef,
  images,
  clearImages,
  pendingImageReads,
  rememberLocalImagePreview,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [activity, setActivity] = useState('idle');
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleSubmit(e, submittedText) {
    e?.preventDefault();
    const text = typeof submittedText === 'string' ? submittedText.trim() : input.trim();
    const editTarget = editingMessage;
    const selectedImages = editTarget ? [] : images;
    if ((!text && selectedImages.length === 0) || isLoading || pendingImageReads > 0 || DELEGATION_ACTIVE_STATUSES.has(delegationStatus)) return;
    if (editTarget) {
      const laterCount = messages.filter(message => !message.pending && isMessageAfter(message, editTarget)).length;
      const warning = `Al editar este mensaje se eliminarán ${laterCount} mensaje${laterCount === 1 ? '' : 's'} posterior${laterCount === 1 ? '' : 'es'} y se generará una respuesta nueva. No se puede deshacer. Los efectos externos de herramientas (por ejemplo, cambios en otros sistemas) no se revierten. ¿Querés continuar?`;
      if (!window.confirm(warning)) return;
    }

    let streamFailure = '';
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
    clearImages();
    setIsLoading(true);
    setActivity('thinking');
    setError(null);

    const userKey = `user-${Date.now()}`;
    const assistantKey = `assistant-${Date.now()}`;
    if (selectedImages.length) {
      rememberLocalImagePreview(persistedContent, selectedImages);
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
          m.id === id ? { ...m, status: 'done', toolName: name, toolResult: output } : m
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
        void loadMessages({ preserveHistory: true });
        void refreshConversation().catch(error => setError(error.message));
      } else {
        const reconciled = await loadMessages({ preserveHistory: true });
        if (!reconciled) setMessages(prev => prev.filter(message => !message.pending));
        setIsHistoryStale(!reconciled);
        setError(`${streamFailure ? `El asistente informó un error: ${streamFailure}.` : 'El turno se interrumpió.'} ${reconciled ? 'Se actualizó el historial; revisá si quedó una respuesta antes de volver a enviarlo.' : 'No se pudo actualizar el historial; usá «Actualizar historial» antes de volver a enviarlo.'} Las herramientas pueden haber aplicado efectos externos aunque no haya llegado una respuesta.`);
      }
    } catch (error) {
      const wasAborted = error.name === 'AbortError';
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
      setError(`${wasAborted ? 'El turno se interrumpió.' : (error.message || 'Falló el envío del mensaje.')} ${reconciled ? 'Se actualizó el historial; revisá si quedó una respuesta antes de volver a enviarlo.' : 'No se pudo actualizar el historial; usá «Actualizar historial» antes de volver a enviarlo.'} Las herramientas pueden haber aplicado efectos externos aunque no haya llegado una respuesta.`);
    } finally {
      abortRef.current = null;
      setIsLoading(false);
      setActivity('idle');
    }
  }

  function handleAbort() {
    setMessages(prev => prev.map(message =>
      message.role === 'tool' && message.status === 'running'
        ? { ...message, status: 'cancelled' }
        : message
    ));
    abortRef.current?.abort();
  }

  return { isLoading, activity, handleSubmit, handleAbort };
}
