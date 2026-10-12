import { useCallback, useEffect, useState } from 'react';
import ConversationList from './ConversationList.jsx';
import Chat from './Chat.jsx';
import client from './client.js';
import Icon from './Icon.jsx';
import AdminConfig from './AdminConfig.jsx';

export default function App() {
  const [activeConv, setActiveConv] = useState(null);
  const [mountedConversations, setMountedConversations] = useState([]);
  const [conversationActivity, setConversationActivity] = useState({});
  const [delegationByConversation, setDelegationByConversation] = useState({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [conversationRefreshKey, setConversationRefreshKey] = useState(0);
  const refreshConversations = useCallback(() => setConversationRefreshKey(key => key + 1), []);
  const refreshDelegations = useCallback(async () => {
    try {
      const items = await client.delegations.list();
      const next = {};
      for (const delegation of [...items].reverse()) {
        next[delegation.targetConversationId] = delegation;
      }
      setDelegationByConversation(next);
    } catch {
      // La lista puede seguir usándose aunque el seguimiento de delegaciones no esté disponible.
    }
  }, []);

  useEffect(() => { void refreshDelegations(); }, [refreshDelegations]);

  // Seguimos las delegaciones activas por SSE, en vez de consultar periódicamente
  // toda la lista. El endpoint reanuda desde el último ID si hay que reconectar.
  const activeDelegationIds = Object.values(delegationByConversation)
    .filter(delegation => delegation.status === 'queued' || delegation.status === 'running')
    .map(delegation => delegation.id)
    .sort()
    .join(',');

  useEffect(() => {
    const controllers = [];
    let active = true;
    const terminalStatuses = new Set(['completed', 'failed', 'interrupted']);
    const updateStatus = (id, status) => {
      setDelegationByConversation(current => {
        const targetId = Object.keys(current).find(key => current[key].id === id);
        if (!targetId) return current;
        const previous = current[targetId].status;
        if (terminalStatuses.has(previous) || previous === status) return current;
        return { ...current, [targetId]: { ...current[targetId], status } };
      });
    };
    const pause = () => new Promise(resolve => setTimeout(resolve, 1500));

    for (const id of activeDelegationIds ? activeDelegationIds.split(',') : []) {
      const controller = new AbortController();
      controllers.push(controller);
      let cursor = '0';

      async function follow() {
        while (active) {
          try {
            const current = await client.delegations.get(id);
            if (!active) return;
            updateStatus(id, current.status);
            if (terminalStatuses.has(current.status)) return;

            await client.delegations.events(id, {
              after: cursor,
              signal: controller.signal,
              onEvent: event => {
                if (!active) return;
                if (event.id) cursor = event.id;
                if (event.type === 'started') updateStatus(id, 'running');
                else if (terminalStatuses.has(event.type)) updateStatus(id, event.type);
              },
            });

            const latest = await client.delegations.get(id);
            if (!active) return;
            updateStatus(id, latest.status);
            if (terminalStatuses.has(latest.status)) return;
          } catch (error) {
            if (!active || error.name === 'AbortError') return;
          }
          if (active) await pause();
        }
      }

      void follow();
    }

    return () => {
      active = false;
      for (const controller of controllers) controller.abort();
    };
  }, [activeDelegationIds]);

  const handleConversationUpdated = useCallback(() => {
    refreshConversations();
    void refreshDelegations();
  }, [refreshConversations, refreshDelegations]);

  function selectConversation(id) {
    setActiveConv(id);
    if (id) {
      setMountedConversations(current => current.includes(id) ? current : [...current, id]);
    }
    setShowAdmin(false);
    setIsSidebarOpen(false);
  }

  const updateConversationActivity = useCallback((id, activity) => {
    setConversationActivity(current => {
      if ((current[id] ?? null) === activity) return current;
      const next = { ...current };
      if (activity) next[id] = activity;
      else delete next[id];
      return next;
    });
  }, []);

  const handleArchive = useCallback((id) => {
    setMountedConversations(current => current.filter(conversationId => conversationId !== id));
    setConversationActivity(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (activeConv === id) setActiveConv(null);
  }, [activeConv]);

  function openAdmin() {
    setShowAdmin(true);
    setIsSidebarOpen(false);
  }

  return (
    <div className={`app-shell${activeConv || showAdmin ? ' has-active-chat' : ''}${isSidebarOpen ? ' sidebar-open' : ''}`}>
      <ConversationList
        activeId={activeConv}
        activityByConversation={conversationActivity}
        delegationByConversation={delegationByConversation}
        onSelect={selectConversation}
        onArchive={handleArchive}
        onOpenAdmin={openAdmin}
        refreshKey={conversationRefreshKey}
      />
      {isSidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Cerrar conversaciones"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <div className="chat-instances" hidden={showAdmin || !activeConv}>
        {mountedConversations.map(id => (
          <div key={id} className="chat-instance" hidden={showAdmin || id !== activeConv}>
            <Chat
              conversationId={id}
              isVisible={!showAdmin && id === activeConv}
              delegationStatus={delegationByConversation[id]?.status}
              onOpenSidebar={() => setIsSidebarOpen(true)}
              onConversationUpdated={handleConversationUpdated}
              onActivityChange={updateConversationActivity}
              onOpenConversation={selectConversation}
            />
          </div>
        ))}
      </div>
      {showAdmin ? (
        <AdminConfig onBack={() => setShowAdmin(false)} />
      ) : !activeConv ? (
        <div id="empty-state">
          <div>Seleccioná un chat o creá uno nuevo</div>
          <button onClick={async () => {
            const conv = await client.conversations.create();
            selectConversation(conv.id);
          }} title="Crear una conversación nueva"><Icon name="plus" /><span>Nuevo chat</span></button>
        </div>
      ) : null}
    </div>
  );
}
