import { useState, useEffect, useRef, useCallback } from 'react';
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

export default function ConversationList({ activeId, activityByConversation = {}, delegationByConversation = {}, onSelect, onArchive, onOpenAdmin, onOpenMemory, refreshKey }) {
  const [convs, setConvs] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const listRef = useRef(null);
  const sentinelRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    let active = true;
    const generation = ++generationRef.current;
    setLoadState('loading');
    setLoadError('');
    setLoadMoreError('');
    setConvs([]);
    setHasMore(false);
    setNextCursor(null);
    loadingMoreRef.current = false;
    setLoadingMore(false);
    client.conversations.listPage({ archived: showArchived, limit: 20 })
      .then(page => {
        if (!active) return;
        setConvs(page.items);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
        setLoadState('ready');
      })
      .catch(error => {
        if (!active) return;
        setLoadError(error.message || 'No se pudieron cargar las conversaciones.');
        setLoadState('error');
      });
    return () => {
      active = false;
      if (generationRef.current === generation) generationRef.current++;
    };
  }, [showArchived, refreshKey, reloadKey]);

  const loadMoreConversations = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !nextCursor) return;
    const generation = generationRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const page = await client.conversations.listPage({
        archived: showArchived,
        limit: 20,
        cursor: nextCursor,
      });
      if (generationRef.current !== generation) return;
      setConvs(current => {
        const merged = new Map(current.map(conversation => [conversation.id, conversation]));
        for (const conversation of page.items) merged.set(conversation.id, conversation);
        return [...merged.values()];
      });
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (generationRef.current === generation) setLoadMoreError(error.message || 'No se pudieron cargar más conversaciones.');
    } finally {
      if (generationRef.current === generation) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasMore, nextCursor, showArchived]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = listRef.current;
    if (!sentinel || !root || !hasMore || loadState !== 'ready' || loadMoreError) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMoreConversations();
    }, { root, rootMargin: '120px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadState, loadMoreError, loadMoreConversations]);

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
        <button className="sidebar-action" onClick={onOpenMemory} aria-label="Memoria" title="Ver y administrar preferencias guardadas"><Icon name="memory" /></button>
        <button className="sidebar-action" onClick={onOpenAdmin} aria-label="Administración" title="Configuración del runtime">⚙</button>
        <button className="sidebar-action" onClick={handleNew} disabled={busyId === 'new'} aria-label="Nuevo chat" title="Crear un nuevo chat"><Icon name="plus" /></button>
      </h2>
      <div className="conversation-list-tabs" role="tablist" aria-label="Conversaciones">
        <button type="button" role="tab" aria-selected={!showArchived} className={!showArchived ? 'active' : ''} onClick={() => { setShowArchived(false); setActionError(''); setActionNotice(''); }}>Activas</button>
        <button type="button" role="tab" aria-selected={showArchived} className={showArchived ? 'active' : ''} onClick={() => { setShowArchived(true); setActionError(''); setActionNotice(''); }}>Archivadas</button>
      </div>
      {actionError && <div className="conversation-list-message conversation-list-error" role="alert">{actionError}</div>}
      {actionNotice && <div className="conversation-list-message conversation-list-notice" role="status">{actionNotice}</div>}
      <div id="conv-list" ref={listRef} aria-busy={loadState === 'loading' || loadingMore}>
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
        {loadState === 'ready' && <div ref={sentinelRef} className="pagination-sentinel" aria-hidden="true" />}
        {loadingMore && <div className="conversation-list-state" role="status">Cargando más conversaciones…</div>}
        {loadMoreError && <div className="conversation-list-state conversation-list-error" role="alert">
          <span>{loadMoreError}</span>
          <button type="button" className="conversation-list-retry" onClick={() => void loadMoreConversations()}>Reintentar</button>
        </div>}
      </div>
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
