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

export default function Chat({ conversationId, isVisible, onOpenSidebar, onConversationUpdated, onActivityChange }) {
  const [messages, setMessages] = useState([]);
  const [conversationTitle, setConversationTitle] = useState('');
  const [agentProfileId, setAgentProfileId] = useState('');
  const [agentProfiles, setAgentProfiles] = useState([]);
  const [isChangingProfile, setIsChangingProfile] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [pendingImageReads, setPendingImageReads] = useState(0);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const imagesRef = useRef([]);
  const imageReadQueueRef = useRef(Promise.resolve());
  const [isLoading, setIsLoading] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [activity, setActivity] = useState('idle');
  const [error, setError] = useState(null);
  const scrollContainerRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const abortRef = useRef(null);
  const imagePreviewsRef = useRef([]);
  const messageLoadRequestRef = useRef(0);
  const messagesRef = useRef([]);
  const hasMoreMessagesRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const scrollRestoreRef = useRef(null);
  const messageInputRef = useRef(null);
  const imageFileInputRef = useRef(null);
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
    if (isLoading) return;
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

  function handleImageSelection(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    setIsAttachMenuOpen(false);
    if (files.length) void handleImageFiles(files);
  }

  function handleInputKeyDown(e) {
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
    } catch (e) {
      if (requestId === messageLoadRequestRef.current) setError(e.message);
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
    onActivityChange?.(conversationId, isLoading ? activity : null);
  }, [activity, conversationId, isLoading, onActivityChange]);

  useEffect(() => () => abortRef.current?.abort(), []);

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

  async function handleSubmit(e) {
    e.preventDefault();
    if ((!input.trim() && images.length === 0) || isLoading || pendingImageReads > 0) return;

    const text = input.trim();
    const selectedImages = images;
    const imageNote = selectedImages.length === 1
      ? '[Imagen adjunta; no almacenada]'
      : `[${selectedImages.length} imágenes adjuntas; no almacenadas]`;
    const persistedContent = selectedImages.length
      ? `${text}${text ? '\n\n' : ''}${imageNote}`
      : text;
    setInput('');
    replaceImages([]);
    setIsLoading(true);
    setActivity('thinking');
    setError(null);

    const userKey = `user-${Date.now()}`;
    const assistantKey = `assistant-${Date.now()}`;
    if (selectedImages.length) {
      imagePreviewsRef.current.push({ content: persistedContent, dataUrls: selectedImages.map(image => image.dataUrl) });
    }
    setMessages(prev => [...prev, {
      id: userKey, conversationId, role: 'user', pending: true,
      content: persistedContent, imageDataUrls: selectedImages.map(image => image.dataUrl),
      toolName: null, toolArgs: null, toolResult: null,
      createdAt: new Date().toISOString(),
    }]);

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
          m.id === id ? { ...m, status: 'done', toolName: name, toolResult: output, content: formatToolOutput(output) } : m
        ));
      },
      onError: (msg) => {
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
      const result = await client.messages.send(conversationId, text, handlers, controller.signal, {
        images: selectedImages.map(image => image.dataUrl),
      });
      if (result === 'ok') {
        await loadMessages({ preserveHistory: true });
        try {
          const conversation = await client.conversations.get(conversationId);
          setConversationTitle(conversation.title ?? '');
          onConversationUpdated?.(conversation);
        } catch (e) {
          setError(e.message);
        }
      }
    } catch (e) {
      const wasAborted = e.name === 'AbortError';
      setMessages(prev => prev.map(message =>
        message.role === 'tool' && message.status === 'running'
          ? { ...message, status: wasAborted ? 'cancelled' : 'error' }
          : message
      ));
      if (!wasAborted) setError(e.message);
    } finally {
      abortRef.current = null;
      setIsLoading(false);
      setActivity('idle');
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

  function handleAbort() {
    setMessages(prev => prev.map(message =>
      message.role === 'tool' && message.status === 'running'
        ? { ...message, status: 'cancelled' }
        : message
    ));
    abortRef.current?.abort();
  }

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
          <span className="conversation-id" title={`ID: ${conversationId}`}>ID: {conversationId.slice(0, 8)}</span>
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
          <button className="reload-button" onClick={loadMessages} disabled={isLoading} title="Actualizar los mensajes" aria-label="Actualizar los mensajes"><Icon name="refresh" /><span>Recargar</span></button>
        </div>
      </header>
      <div
        ref={scrollContainerRef}
        className="messages"
        onScroll={handleMessagesScroll}
      >
        {isLoadingOlder && <div className="history-loading" role="status">Cargando mensajes anteriores…</div>}
        {renderMessageList(messages)}
        {isLoading && (
          <div className="thinking-slot">
            {activity === 'thinking' && <ThinkingIndicator />}
          </div>
        )}
      </div>
      {error && <div className="error-bar" role="alert">{error}</div>}
      <form onSubmit={handleSubmit} className="composer">
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
        <div className="composer-row">
          <div className="attachment-menu-wrap">
            <button
              type="button"
              className="attach-button"
              disabled={isLoading}
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
          <textarea
            ref={messageInputRef}
            className="message-input"
            value={input}
            onChange={handleInputChange}
            onPaste={handleInputPaste}
            onKeyDown={handleInputKeyDown}
            placeholder="Escribí un mensaje..."
            disabled={isLoading}
            maxLength={MAX_MESSAGE_CHARS}
            rows={1}
            aria-label="Mensaje"
          />
          <button className="send-button" type="submit" disabled={isLoading || (!input.trim() && images.length === 0)} title="Enviar mensaje" aria-label="Enviar mensaje"><Icon name="send" /><span>Enviar</span></button>
          <button className="stop-button" type="button" disabled={!isLoading} onClick={handleAbort} title="Detener la respuesta" aria-label="Detener la respuesta"><Icon name="stop" /><span>Parar</span></button>
        </div>
        <small className="message-length" aria-label="Longitud del mensaje">
          {input.length.toLocaleString('es-AR')} / {MAX_MESSAGE_CHARS.toLocaleString('es-AR')} caracteres · el límite de contexto del modelo también aplica
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

function renderMessageList(messages) {
  const rendered = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (!isStackableTool(message)) {
      rendered.push(<MessageBubble key={message.id} message={message} />);
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
      ? <ToolStack key={`tool-stack-${stack[0].id}`} messages={stack} />
      : <MessageBubble key={stack[0].id} message={stack[0]} />);
  }

  return rendered;
}

function isStackableTool(message) {
  return message?.role === 'tool' && !parseProposal(message.toolResult);
}

function ToolStack({ messages }) {
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
        {messages.map(message => <MessageBubble key={message.id} message={message} />)}
      </div>
    </details>
  );
}

function MessageBubble({ message }) {
  if (message.role === 'tool') {
    const proposal = parseProposal(message.toolResult);
    if (proposal) return <ProposalCard proposal={proposal} />;
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
      {message.role === 'assistant'
        ? <MarkdownContent content={message.content} />
        : message.content}
      {(message.imageDataUrls ?? (message.imageDataUrl ? [message.imageDataUrl] : [])).map((imageDataUrl, index) => (
        <img className="message-image" src={imageDataUrl} alt={`Imagen adjunta ${index + 1}`} key={`${message.id}-image-${index}`} />
      ))}
    </div>
  );
}

function MarkdownContent({ content }) {
  return <div className="markdown-content">{renderMarkdownBlocks(content || '')}</div>;
}

function renderMarkdownBlocks(content) {
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
      blocks.push(<blockquote key={`quote-${index}`}>{renderMarkdownBlocks(quote.join('\n'))}</blockquote>);
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

    const paragraph = [line.trim()];
    index++;
    while (index < lines.length && lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !/^\s{0,3}#{1,6}\s+/.test(lines[index]) &&
      !/^\s*>/.test(lines[index]) &&
      !/^\s*(?:[-+*]|\d+\.)\s+/.test(lines[index]) &&
      !/^\s{0,3}(?:---+|___+|\*\*\*+)\s*$/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index++;
    }
    blocks.push(<p key={`paragraph-${index}`}><MarkdownInline text={paragraph.join(' ')} /></p>);
  }

  return blocks;
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

function ProposalCard({ proposal }) {
  const [status, setStatus] = useState(null);

  async function decide(decision) {
    try {
      const res = await fetch(`http://localhost:3010/v1/conversations/${proposal.id}/user-actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'confirm_proposal', input: { proposalId: proposal.id, decision } }),
      });
      const data = await res.json();
      setStatus(data.message || `${decision} enviado`);
    } catch {
      alert('Error al enviar decisión');
    }
  }

  return (
    <div className="bubble tool">
      <div className="proposal">
        <div className="proposal-title">{proposal.title}</div>
        <div className="proposal-lines">
          {proposal.lines.map(l => (
            <div key={l.label} className="proposal-line">
              <span>{l.label}</span>
              <span>{l.value}</span>
            </div>
          ))}
        </div>
        <div className="proposal-actions">
          <button className="btn-confirm" onClick={() => decide('confirm')} title="Confirmar propuesta"><Icon name="check" /><span>Confirmar</span></button>
          <button className="btn-cancel" onClick={() => decide('cancel')} title="Cancelar propuesta"><Icon name="cancel" /><span>Cancelar</span></button>
        </div>
        {status && <div className="proposal-status">{status}</div>}
      </div>
    </div>
  );
}

function parseProposal(toolResult) {
  if (!toolResult) return null;
  try {
    const rec = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
    if (!rec || typeof rec !== 'object') return null;
    const proposal = rec.proposal ?? rec;
    if (!proposal || typeof proposal !== 'object') return null;
    if (typeof proposal.id !== 'string') return null;
    if (typeof proposal.title !== 'string') return null;
    return {
      id: proposal.id,
      title: proposal.title,
      lines: Array.isArray(proposal.lines) ? proposal.lines.filter(l => l && typeof l.label === 'string' && typeof l.value === 'string') : [],
      dangerous: proposal.dangerous === true,
      expiresAt: proposal.expiresAt ?? '',
      confirmTool: proposal.confirmTool ?? 'confirm_proposal',
    };
  } catch {
    return null;
  }
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

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
