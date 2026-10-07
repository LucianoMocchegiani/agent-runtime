import { useState, useEffect, useRef, useCallback } from 'react';
import client from './client.js';

const MODEL_KEY = 'chat_model';

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

export default function Chat({ conversationId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const { models, model, select } = useModels();
  const bottomRef = useRef(null);
  const abortRef = useRef(null);

  const loadMessages = useCallback(async () => {
    try {
      const msgs = await client.messages.list(conversationId);
      setMessages(msgs);
    } catch (e) {
      setError(e.message);
    }
  }, [conversationId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const text = input.trim();
    setInput('');
    setIsLoading(true);
    setError(null);

    const userKey = `user-${Date.now()}`;
    const assistantKey = `assistant-${Date.now()}`;

    setMessages(prev => [...prev, {
      id: userKey, conversationId, role: 'user',
      content: text, toolName: null, toolArgs: null, toolResult: null,
      createdAt: new Date().toISOString(),
    }]);

    const handlers = {
      onTextDelta: (delta) => {
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
        setMessages(prev => [...prev, {
          id, conversationId, role: 'tool',
          content: '', toolName: name, toolArgs: null, toolResult: null,
          createdAt: new Date().toISOString(),
        }]);
      },
      onToolDone: (id, name, output) => {
        setMessages(prev => prev.map(m =>
          m.id === id ? { ...m, toolName: name, toolResult: output, content: output ? String(output).slice(0, 200) : '' } : m
        ));
      },
      onError: (msg) => setError(msg),
      onFinish: () => { loadMessages(); },
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await client.messages.send(conversationId, text, handlers, controller.signal, { model });
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message);
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  }

  function handleAbort() {
    abortRef.current?.abort();
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #333', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ color: '#888', fontSize: 13 }}>{conversationId.slice(0, 8)}</span>
        <span style={{ flex: 1 }} />
        <ModelPicker models={models} value={model} onChange={select} disabled={isLoading} />
        <button onClick={loadMessages} disabled={isLoading} style={{ padding: '4px 10px', fontSize: 12 }}>Recargar</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.map(m => <MessageBubble key={m.id} message={m} />)}
        <div ref={bottomRef} />
      </div>
      {error && <div style={{ padding: 8, background: '#331', color: '#f88', fontSize: 13 }}>{error}</div>}
      <form onSubmit={handleSubmit} style={{ padding: 12, borderTop: '1px solid #333', display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Escribí un mensaje..."
          disabled={isLoading}
          style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid #444', background: '#16213e', color: '#e0e0e0', fontSize: 14 }}
        />
        <button type="submit" disabled={isLoading}>Enviar</button>
        <button type="button" disabled={!isLoading} onClick={handleAbort}>Parar</button>
      </form>
    </div>
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

function MessageBubble({ message }) {
  if (message.role === 'tool') {
    const proposal = parseProposal(message.toolResult);
    if (proposal) return <ProposalCard proposal={proposal} />;
    return (
      <div className="bubble tool">
        <span className="tool-name">{message.toolName || 'tool'}</span>
        <div className="tool-result">{truncate(String(message.content || message.toolResult || ''), 300)}</div>
      </div>
    );
  }
  return <div className={`bubble ${message.role}`}>{message.content}</div>;
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
          <button className="btn-confirm" onClick={() => decide('confirm')}>Confirmar</button>
          <button className="btn-cancel" onClick={() => decide('cancel')}>Cancelar</button>
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

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
