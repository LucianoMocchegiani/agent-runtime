import { useCallback, useState } from 'react';
import client from './client.js';
import Icon from './Icon.jsx';
import useCursorPagination from './useCursorPagination.js';
import styles from './ConversationList.module.css';

const activityLabels = {
  thinking: 'Pensando',
  responding: 'Respondiendo',
  tool: 'Usando herramienta',
};
const delegationLabels = {
  queued: 'Conversación delegada',
  running: 'Conversación delegada',
};

export default function ConversationList({ isSidebarOpen = false, hasActiveChat = false, activeId, activityByConversation = {}, delegationByConversation = {}, onSelect, onArchive, onOpenAdmin, onOpenMemory, refreshKey }) {
  const [showArchived, setShowArchived] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const fetchConversations = useCallback(({ limit, cursor }) => client.conversations.listPage({
    archived: showArchived,
    limit,
    ...(cursor ? { cursor } : {}),
  }), [showArchived]);
  const {
    items: convs,
    setItems: setConvs,
    loadState,
    loadError,
    hasMore,
    loadingMore,
    loadMoreError,
    loadMore,
    rootRef: listRef,
    sentinelRef,
  } = useCursorPagination({
    fetchPage: fetchConversations,
    resetKey: `${showArchived}:${refreshKey}:${reloadKey}`,
    loadErrorMessage: 'No se pudieron cargar las conversaciones.',
    loadMoreErrorMessage: 'No se pudieron cargar más conversaciones.',
    rootMargin: '120px',
  });

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
    <div className={`${styles.sidebar} ${isSidebarOpen ? styles.sidebarOpen : ''} ${!hasActiveChat ? styles.sidebarNoChat : ''}`}>
      <h2>
        <span>Chat</span>
        <button className={styles.sidebarAction} onClick={onOpenMemory} aria-label="Memoria" title="Ver y administrar preferencias guardadas"><Icon name="memory" /></button>
        <button className={styles.sidebarAction} onClick={onOpenAdmin} aria-label="Administración" title="Configuración del runtime">⚙</button>
        <button className={styles.sidebarAction} onClick={handleNew} disabled={busyId === 'new'} aria-label="Nuevo chat" title="Crear un nuevo chat"><Icon name="plus" /></button>
      </h2>
      <div className={styles.conversationListTabs} role="tablist" aria-label="Conversaciones">
        <button type="button" role="tab" aria-selected={!showArchived} className={!showArchived ? styles.active : ''} onClick={() => { setShowArchived(false); setActionError(''); setActionNotice(''); }}>Activas</button>
        <button type="button" role="tab" aria-selected={showArchived} className={showArchived ? styles.active : ''} onClick={() => { setShowArchived(true); setActionError(''); setActionNotice(''); }}>Archivadas</button>
      </div>
      {actionError && <div className={[styles.conversationListMessage, styles.conversationListError].join(' ')} role="alert">{actionError}</div>}
      {actionNotice && <div className={[styles.conversationListMessage, styles.conversationListNotice].join(' ')} role="status">{actionNotice}</div>}
      <div className={styles.convList} ref={listRef} aria-busy={loadState === 'loading' || loadingMore}>
        {loadState === 'loading' && <div className={styles.conversationListState} role="status">Cargando conversaciones…</div>}
        {loadState === 'error' && (
          <div className={[styles.conversationListState, styles.conversationListError].join(' ')} role="alert">
            <span>No se pudo cargar la lista: {loadError}</span>
            <button type="button" className={styles.conversationListRetry} onClick={retryLoad}>Reintentar</button>
          </div>
        )}
        {loadState === 'ready' && convs.length === 0 && (
          <div className={styles.conversationListState}>{showArchived ? 'No hay conversaciones archivadas' : 'Sin conversaciones'}</div>
        )}
        {loadState === 'ready' && convs.map(c => {
          const title = c.title || 'Sin título';
          const activity = activityByConversation[c.id];
          const delegation = delegationByConversation[c.id];
          const delegationLabel = delegationLabels[delegation?.status];
          return (
            <div key={c.id} className={`${styles.convItem} ${c.id === activeId ? styles.active : ''}`}>
              <button type="button" className={styles.convSelect} onClick={() => !showArchived && onSelect(c.id)} disabled={showArchived} title={showArchived ? `${title} · Restaurá para abrirla` : title} aria-current={c.id === activeId ? 'page' : undefined}>
                <span className={styles.convTitle}>{title}</span>
                {delegationLabel
                  ? <span className={styles.convActivity} role="status" aria-label={delegationLabel} title={delegationLabel}><span className={styles.convActivityDot} aria-hidden="true" />{delegationLabel}</span>
                  : activity && <span className={styles.convActivity} role="status" aria-label={`Agente ${activityLabels[activity] ?? 'en ejecución'}`} title={`Agente ${activityLabels[activity] ?? 'en ejecución'}`}><span className={styles.convActivityDot} aria-hidden="true" />{activityLabels[activity] ?? 'En curso'}</span>}
                <span className={styles.convDate}>{fmtDate(c.updatedAt)}</span>
              </button>
              {showArchived ? (
                <button type="button" className={styles.restoreButton} onClick={() => handleRestore(c.id)} disabled={busyId === c.id} aria-label={`Restaurar ${title}`} title={`Restaurar ${title}`}>
                  {busyId === c.id ? 'Restaurando…' : 'Restaurar'}
                </button>
              ) : (
                <button type="button" className={styles.archiveButton} onClick={() => handleArchive(c.id)} disabled={busyId === c.id} aria-label={`Archivar ${title}`} title={`Archivar ${title}`}><Icon name="archive" /></button>
              )}
            </div>
          );
        })}
        {loadState === 'ready' && <div ref={sentinelRef} className={styles.paginationSentinel} aria-hidden="true" />}
        {loadingMore && <div className={styles.conversationListState} role="status">Cargando más conversaciones…</div>}
        {loadMoreError && <div className={[styles.conversationListState, styles.conversationListError].join(' ')} role="alert">
          <span>{loadMoreError}</span>
          <button type="button" className={styles.conversationListRetry} onClick={() => void loadMore()}>Reintentar</button>
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
