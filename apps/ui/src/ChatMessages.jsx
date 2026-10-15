import { useState, useEffect, useId } from 'react';
import client from './client.js';
import Icon from './Icon.jsx';

function hasUnstoredImage(message) {
  return message.content.includes('[Imagen adjunta; no almacenada]')
    || message.content.includes('imágenes adjuntas; no almacenadas]');
}

export function ThinkingIndicator() {
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

export function MessageList({ messages, onOpenConversation, onEditMessage }) {
  return renderMessageList(messages, onOpenConversation, onEditMessage);
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

function MermaidDiagram({ chart }) {
  const reactId = useId();
  const [result, setResult] = useState({ svg: '', error: false });
  const diagramId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(() => {
    let isCurrent = true;
    setResult({ svg: '', error: false });
    import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'dark',
        flowchart: { htmlLabels: false },
      });
      const { svg } = await mermaid.render(diagramId, chart);
      if (isCurrent) setResult({ svg, error: false });
    }).catch(() => {
      if (isCurrent) setResult({ svg: '', error: true });
    });
    return () => { isCurrent = false; };
  }, [chart, diagramId]);

  if (result.error) {
    return (
      <div className="mermaid-fallback" role="status">
        <p>No se pudo dibujar este diagrama. Se muestra el código para que puedas revisarlo.</p>
        <pre className="markdown-code"><code>{chart}</code></pre>
      </div>
    );
  }
  if (!result.svg) return <div className="mermaid-loading" role="status">Dibujando diagrama…</div>;
  return <div className="mermaid-diagram" role="img" aria-label="Diagrama Mermaid" dangerouslySetInnerHTML={{ __html: result.svg }} />;
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
      const source = code.join('\n');
      if (fence[1].trim().toLowerCase() === 'mermaid') {
        blocks.push(<MermaidDiagram key={`mermaid-${index}`} chart={source} />);
      } else {
        blocks.push(<pre className="markdown-code" key={`code-${index}`}><code>{source}</code></pre>);
      }
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

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '\u2026' : s; }
