import { useState, useEffect } from 'react';
import client from './client.js';
import Icon from './Icon.jsx';

export default function ConversationList({ activeId, onSelect, onOpenAdmin }) {
  const [convs, setConvs] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const items = await client.conversations.list();
      setConvs(items);
    } catch {
      setConvs([]);
    }
  }

  async function handleNew() {
    const conv = await client.conversations.create();
    onSelect(conv.id);
  }

  async function handleArchive(id) {
    await client.conversations.archive(id);
    if (activeId === id) onSelect(null);
    load();
  }

  return (
    <div id="sidebar">
      <h2>
        <span>Chat</span>
        <button className="sidebar-action" onClick={onOpenAdmin} aria-label="Administración" title="Configuración del runtime">⚙</button>
        <button className="sidebar-action" onClick={handleNew} aria-label="Nuevo chat" title="Crear un nuevo chat"><Icon name="plus" /></button>
      </h2>
      <div id="conv-list">
        {convs.length === 0 && <div style={{ padding: 16, color: '#666', textAlign: 'center' }}>Sin conversaciones</div>}
        {convs.map(c => (
          <div key={c.id} className={`conv-item ${c.id === activeId ? 'active' : ''}`}>
            <span className="conv-title" onClick={() => onSelect(c.id)}>{c.title || 'Sin título'}</span>
            <span className="conv-date">{fmtDate(c.updatedAt)}</span>
            <button className="archive-button" onClick={() => handleArchive(c.id)} aria-label={`Archivar ${c.title || 'conversación'}`} title={`Archivar ${c.title || 'conversación'}`}><Icon name="archive" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}