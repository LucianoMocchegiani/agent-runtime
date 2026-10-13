import { useState, useEffect } from 'react';
import client from './client.js';
import Icon from './Icon.jsx';

const activityLabels = {
  thinking: 'Pensando',
  responding: 'Respondiendo',
  tool: 'Usando herramienta',
};
const delegationLabels = {
  queued: 'Conversación delegada',
  running: 'Conversación delegada',
};

export default function ConversationList({ activeId, activityByConversation = {}, delegationByConversation = {}, onSelect, onArchive, onOpenAdmin, refreshKey }) {
  const [convs, setConvs] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadState('loading');
    setLoadError('');
    client.conversations.list({ archived: showArchived })
      .then(items => {
        if (!active) return;
        setConvs(items);
        setLoadState('ready');
      })
      .catch(error => {
        if (!active) return;
        setLoadError(error.message || 'No se pudieron cargar las conversaciones.');
        setLoadState('error');
      });
    return () => { active = false; };
  }, [showArchived, refreshKey, reloadKey]);

  function retryLoad() {
    setReloadKey(key => key + 1);
  }

  async function handleNew() {
    setActionError('');
    setActionNotice('');
    setBusyId('new');
    try {
      const conv = await client.conversations.create();
      onSelect(conv.id);
    } catch (error) {
      setActionError(error.message || 'No se pudo crear la conversación.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleArchive(id) {
    setActionError('');
    setActionNotice('');
    setBusyId(id);
    try {
      await client.conversations.archive(id);
      setConvs(current => current.filter(conversation => conversation.id !== id));
      onArchive?.(id);
      setReloadKey(key => key + 1);
    } catch (error) {
      setActionError(error.message || 'No se pudo archivar la conversación.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(id) {
    setActionError('');
    setActionNotice('');
    setBusyId(id);
    try {
      await client.conversations.patch(id, { archived: false });
      setConvs(current => current.filter(conversation => conversation.id !== id));
      setActionNotice('Conversación restaurada. Ya está disponible en Activas.');
    } catch (error) {
      setActionError(error.message || 'No se pudo restaurar la conversación.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div id="sidebar">
      <h2>
        <span>Chat</span>
        <button className="sidebar-action" onClick={onOpenAdmin} aria-label="Administración" title="Configuración del runtime">⚙</button>
        <button className="sidebar-action" onClick={handleNew} disabled={busyId === 'new'} aria-label="Nuevo chat" title="Crear un nuevo chat"><Icon name="plus" /></button>
      </h2>
      <div className="conversation-list-tabs" role="tablist" aria-label="Conversaciones">
        <button type="button" role="tab" aria-selected={!showArchived} className={!showArchived ? 'active' : ''} onClick={() => { setShowArchived(false); setActionError(''); setActionNotice(''); }}>Activas</button>
        <button type="button" role="tab" aria-selected={showArchived} className={showArchived ? 'active' : ''} onClick={() => { setShowArchived(true); setActionError(''); setActionNotice(''); }}>Archivadas</button>
      </div>
      {actionError && <div className="conversation-list-message conversation-list-error" role="alert">{actionError}</div>}
      {actionNotice && <div className="conversation-list-message conversation-list-notice" role="status">{actionNotice}</div>}
      <div id="conv-list" aria-busy={loadState === 'loading'}>
        {loadState === 'loading' && <div className="conversation-list-state" role="status">Cargando conversaciones…</div>}
        {loadState === 'error' && (
          <div className="conversation-list-state conversation-list-error" role="alert">
            <span>No se pudo cargar la lista: {loadError}</span>
            <button type="button" className="conversation-list-retry" onClick={retryLoad}>Reintentar</button>
          </div>
        )}
        {loadState === 'ready' && convs.length === 0 && (
          <div className="conversation-list-state">{showArchived ? 'No hay conversaciones archivadas' : 'Sin conversaciones'}</div>
        )}
        {loadState === 'ready' && convs.map(c => {
          const title = c.title || 'Sin título';
          const activity = activityByConversation[c.id];
          const delegation = delegationByConversation[c.id];
          const delegationLabel = delegationLabels[delegation?.status];
          return (
            <div key={c.id} className={`conv-item ${c.id === activeId ? 'active' : ''}`}>
              <button type="button" className="conv-select" onClick={() => !showArchived && onSelect(c.id)} disabled={showArchived} title={showArchived ? `${title} · Restaurá para abrirla` : title} aria-current={c.id === activeId ? 'page' : undefined}>
                <span className="conv-title">{title}</span>
                {delegationLabel
                  ? <span className="conv-activity" role="status" aria-label={delegationLabel} title={delegationLabel}><span className="conv-activity-dot" aria-hidden="true" />{delegationLabel}</span>
                  : activity && <span className="conv-activity" role="status" aria-label={`Agente ${activityLabels[activity] ?? 'en ejecución'}`} title={`Agente ${activityLabels[activity] ?? 'en ejecución'}`}><span className="conv-activity-dot" aria-hidden="true" />{activityLabels[activity] ?? 'En curso'}</span>}
                <span className="conv-date">{fmtDate(c.updatedAt)}</span>
              </button>
              {showArchived ? (
                <button type="button" className="restore-button" onClick={() => handleRestore(c.id)} disabled={busyId === c.id} aria-label={`Restaurar ${title}`} title={`Restaurar ${title}`}>
                  {busyId === c.id ? 'Restaurando…' : 'Restaurar'}
                </button>
              ) : (
                <button type="button" className="archive-button" onClick={() => handleArchive(c.id)} disabled={busyId === c.id} aria-label={`Archivar ${title}`} title={`Archivar ${title}`}><Icon name="archive" /></button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
