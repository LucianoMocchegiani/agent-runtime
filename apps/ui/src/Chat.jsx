import { useState, useEffect, useRef, useCallback } from 'react';
import client from './client.js';
import Icon from './Icon.jsx';

const MODEL_KEY = 'chat_model';
const MAX_IMAGES = 10;

function useModels() {
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_KEY) || '');

  useEffect(() => {
    client.models.list()
      .then(({ default: def, items }) => {
        setModels(items);
        setModel(prev => (items.some(m => m.id === prev) ? prev : def));
      })
      .catch(() => setModels([]));
  }, []);

  function select(id) {
    setModel(id);
    localStorage.setItem(MODEL_KEY, id);
  }

  return { models, model, select };
}

function reconcileLiveTurn(liveMessages, persistedMessages, turnStartIndex) {
  const history = persistedMessages.slice(0, turnStartIndex);
  const liveTurn = liveMessages.slice(turnStartIndex);
  const savedTurn = persistedMessages.slice(turnStartIndex);
  const savedTools = savedTurn.filter(message => message.role === 'tool');
  const usedSavedTools = new Set();
  let nextToolIndex = 0;

  const reconciledTurn = liveTurn.map(message => {
    if (message.role === 'tool') {
      let savedIndex = savedTools.findIndex((saved, index) =>
        index >= nextToolIndex && saved.toolName === message.toolName
      );
      if (savedIndex < 0) savedIndex = savedTools.findIndex((_, index) => index >= nextToolIndex);
      if (savedIndex < 0) return message;

      nextToolIndex = savedIndex + 1;
      const saved = savedTools[savedIndex];
      usedSavedTools.add(saved.id);
      return {
        ...message,
        toolName:
          message.toolName && message.toolName !== 'tool'
            ? message.toolName
            : saved.toolName || message.toolName,
        toolArgs: saved.toolArgs ?? message.toolArgs,
        toolResult: saved.toolResult ?? message.toolResult,
        content: message.content || saved.content,
        status: 'done',
      };
    }

    if (message.role === 'assistant' && !message.content) {
      const savedText = savedTurn
        .filter(item => item.role === 'assistant')
        .map(item => item.content)
        .filter(Boolean)
        .join('\n\n');
      return savedText ? { ...message, content: savedText } : message;
    }
    return message;
  });

  const missingTools = savedTools
    .filter(message => !usedSavedTools.has(message.id))
    .map(message => ({ ...message, status: 'done' }));
  const hasAssistant = reconciledTurn.some(message => message.role === 'assistant' && message.content);
  const savedAssistant = savedTurn.filter(message => message.role === 'assistant' && message.content);
  const missingAssistant = !hasAssistant && savedAssistant.length > 0 ? savedAssistant : [];

  return [...history, ...reconciledTurn, ...missingTools, ...missingAssistant];
}

export default function Chat({ conversationId, onOpenSidebar }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [pendingImageReads, setPendingImageReads] = useState(0);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const imagesRef = useRef([]);
  const imageReadQueueRef = useRef(Promise.resolve());
  const [isLoading, setIsLoading] = useState(false);
  const [activity, setActivity] = useState('idle');
  const [error, setError] = useState(null);
  const { models, model, select } = useModels();
  const scrollContainerRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const abortRef = useRef(null);
  const imagePreviewsRef = useRef([]);
  const turnStartIndexRef = useRef(null);
  const messageInputRef = useRef(null);
  const imageFileInputRef = useRef(null);

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
  
  const loadMessages = useCallback(async ({ preserveLiveTurn = false } = {}) => {
    const turnStartIndex = preserveLiveTurn ? turnStartIndexRef.current : null;
    try {
      const msgs = await client.messages.list(conversationId);
      const previews = [...imagePreviewsRef.current];
      const withLocalPreviews = msgs.map(message => {
        if (message.role !== 'user') return message;
        const previewIndex = previews.findIndex(preview => preview.content === message.content);
        if (previewIndex < 0) return message;
        const [preview] = previews.splice(previewIndex, 1);
        return { ...message, imageDataUrls: preview.dataUrls };
      });
      setMessages(current => turnStartIndex === null
        ? withLocalPreviews
        : reconcileLiveTurn(current, withLocalPreviews, turnStartIndex));
      if (preserveLiveTurn) turnStartIndexRef.current = null;
    } catch (e) {
      setError(e.message);
    } finally {
      if (preserveLiveTurn) turnStartIndexRef.current = null;
    }
  }, [conversationId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container && shouldStickToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  function handleMessagesScroll() {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= 64;
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
    turnStartIndexRef.current = messages.length;

    if (selectedImages.length) {
      imagePreviewsRef.current.push({ content: persistedContent, dataUrls: selectedImages.map(image => image.dataUrl) });
    }
    setMessages(prev => [...prev, {
      id: userKey, conversationId, role: 'user',
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
            id: assistantKey, conversationId, role: 'assistant',
            content: delta, toolName: null, toolArgs: null, toolResult: null,
            createdAt: new Date().toISOString(),
          }];
        });
      },
      onToolStart: (id, name) => {
        setActivity('tool');
        setMessages(prev => [...prev, {
          id, conversationId, role: 'tool', status: 'running',
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
      onFinish: () => { void loadMessages({ preserveLiveTurn: true }); },
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await client.messages.send(conversationId, text, handlers, controller.signal, {
        model,
        images: selectedImages.map(image => image.dataUrl),
      });
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
        <span className="conversation-id">{conversationId.slice(0, 8)}</span>
        <span className="header-spacer" />
        <ModelPicker models={models} value={model} onChange={select} disabled={isLoading} />
        <div className="toolbar">
          <button className="reload-button" onClick={loadMessages} disabled={isLoading} title="Actualizar los mensajes" aria-label="Actualizar los mensajes"><Icon name="refresh" /><span>Recargar</span></button>
        </div>
      </header>
      <div
        ref={scrollContainerRef}
        className="messages"
        onScroll={handleMessagesScroll}
      >
        {messages.map(m => <MessageBubble key={m.id} message={m} />)}
        {isLoading && activity === 'thinking' && <ThinkingIndicator />}
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
            rows={1}
            aria-label="Mensaje"
          />
          <button className="send-button" type="submit" disabled={isLoading || (!input.trim() && images.length === 0)} title="Enviar mensaje" aria-label="Enviar mensaje"><Icon name="send" /><span>Enviar</span></button>
          <button className="stop-button" type="button" disabled={!isLoading} onClick={handleAbort} title="Detener la respuesta" aria-label="Detener la respuesta"><Icon name="stop" /><span>Parar</span></button>
        </div>
      </form>
    </main>
  );
}

function ModelPicker({ models, value, onChange, disabled }) {
  if (models.length === 0) return null;
  const groups = [...models.reduce((acc, m) => {
    acc.set(m.providerLabel, [...(acc.get(m.providerLabel) ?? []), m]);
    return acc;
  }, new Map())];
  return (
    <select className="model-picker" value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>
      {groups.map(([label, items]) => (
        <optgroup key={label} label={label}>
          {items.map(m => <option key={m.id} value={m.id}>{m.model}</option>)}
        </optgroup>
      ))}
    </select>
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
