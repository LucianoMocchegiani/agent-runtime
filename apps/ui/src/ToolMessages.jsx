import ChatStyles from './ToolMessages.module.css';

import { useState, useEffect } from 'react';

import ActivityDots from './ActivityDots.jsx';

import client from './client.js';



export function collectToolMessages(messages, startIndex) {

  const stack = [messages[startIndex]];

  let nextIndex = startIndex + 1;

  while (nextIndex < messages.length && messages[nextIndex]?.role === 'tool') {

    stack.push(messages[nextIndex]);

    nextIndex++;

  }

  return { messages: stack, nextIndex };

}



export function ToolStack({ messages, onOpenConversation }) {

  const names = [...new Set(messages.map(message => message.toolName || 'Herramienta'))];

  const nameSummary = names.slice(0, 3).join(', ');

  const remainingNames = names.length - 3;

  const runningCount = messages.filter(message => message.status === 'running').length;

  const errorCount = messages.filter(message => message.status === 'error').length;



  return (

    <details className={ChatStyles.toolStack}>

      <summary className={ChatStyles.toolStackSummary}>

        <span className={ChatStyles.toolStackCount}>{messages.length} llamadas</span>

        <span className={ChatStyles.toolStackNames}>{nameSummary}{remainingNames > 0 ? ` y ${remainingNames} más` : ''}</span>

        {runningCount > 0 && <span className={ChatStyles.toolStackStatus}><span className={ChatStyles.toolSpinner} />{runningCount} ejecutando</span>}

        {errorCount > 0 && <span className={[ChatStyles.toolStackStatus, ChatStyles.toolStatusError].join(' ')}>{errorCount} con error</span>}

      </summary>

      <div className={ChatStyles.toolStackItems}>

        {messages.map(message => <ToolMessage key={message.id} message={message} onOpenConversation={onOpenConversation} />)}

      </div>

    </details>

  );

}



export function ToolMessage({ message, onOpenConversation }) {

  const delegation = message.toolName === 'delegate_to_conversation' ? parseDelegation(message.toolResult) : null;

  if (delegation) return <DelegationCard delegation={delegation} onOpenConversation={onOpenConversation} />;

  const output = formatToolOutput(message.toolResult ?? message.content, message.toolName);

  const outputLines = output ? output.split('\n').length : 0;

  return (

    <div className={`${ChatStyles.toolBubble} ${message.status === 'running' ? ChatStyles.toolRunning : ''}`}>

      <div className={ChatStyles.toolHeading}>

        <span className={ChatStyles.toolName}>{message.toolName || 'Herramienta'}</span>

        {message.status === 'running' && <span className={ChatStyles.toolStatus}><span className={ChatStyles.toolSpinner} />Ejecutando <ActivityDots /></span>}

        {message.status === 'cancelled' && <span className={ChatStyles.toolStatus}>Cancelada</span>}

        {message.status === 'error' && <span className={[ChatStyles.toolStatus, ChatStyles.toolStatusError].join(' ')}>Error</span>}

      </div>

      {message.status === 'running'

        ? <div className={[ChatStyles.toolResult, ChatStyles.toolPending].join(' ')}>Esperando respuesta…</div>

        : output && (

          <details className={ChatStyles.toolOutputDetails}>

            <summary>Resultado · {outputLines} {outputLines === 1 ? 'línea' : 'líneas'}</summary>

            <pre className={ChatStyles.toolResult}>{truncate(output, 12000)}</pre>

          </details>

        )}

    </div>

  );

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

    <section className={ChatStyles.delegationCard} aria-label="Seguimiento de delegación">

      <div className={ChatStyles.delegationHeading}>

        <strong>Delegación al otro hilo</strong>

        <span className={`${ChatStyles.delegationStatus} ${ChatStyles[`delegationStatus${status[0].toUpperCase()}${status.slice(1)}`]}`} role="status">

          {status === 'running' && <span className={ChatStyles.toolSpinner} />}

          {DELEGATION_STATUS_LABELS[status] ?? status}

        </span>

      </div>

      <div className={ChatStyles.delegationMeta}>ID: <code>{delegation.id}</code></div>

      {events.length > 0 && (

        <ol className={ChatStyles.delegationEvents} aria-label="Eventos de la delegación">

          {events.map((event, index) => (

            <li key={event.id || `${event.type}-${index}`}>

              <span className={ChatStyles.delegationEventDot} />

              <span>{DELEGATION_EVENT_LABELS[event.type] ?? `Evento: ${event.type}`}</span>

            </li>

          ))}

        </ol>

      )}

      {status === 'completed' && <p className={ChatStyles.delegationNote}>El resultado quedó guardado en la conversación de destino.</p>}

      {status === 'interrupted' && <p className={ChatStyles.delegationNote}>El trabajo se detuvo por una interrupción y no se volverá a ejecutar automáticamente.</p>}

      {status === 'failed' && <p className={ChatStyles.delegationNote}>El trabajo no pudo completarse.</p>}

      {error && <p className={ChatStyles.delegationError}>{error} Se volverá a intentar la conexión.</p>}

      <button type="button" className={ChatStyles.delegationOpenButton} onClick={() => onOpenConversation?.(targetId)}>

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
