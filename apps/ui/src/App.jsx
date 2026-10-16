import { useCallback, useState } from 'react';
import ConversationList from './ConversationList.jsx';
import Chat from './Chat.jsx';
import client from './client.js';
import Icon from './Icon.jsx';
import AdminConfig from './AdminConfig.jsx';
import MemoryManager from './MemoryManager.jsx';
import useDelegationTracking from './useDelegationTracking.js';

export default function App() {
  const [activeConv, setActiveConv] = useState(null);
  const [mountedConversations, setMountedConversations] = useState([]);
  const [conversationActivity, setConversationActivity] = useState({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [conversationRefreshKey, setConversationRefreshKey] = useState(0);
  const refreshConversations = useCallback(() => setConversationRefreshKey(key => key + 1), []);
  const { delegationByConversation, refreshDelegations } = useDelegationTracking();

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
    setShowMemory(false);
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
    setShowMemory(false);
    setIsSidebarOpen(false);
  }

  function openMemory() {
    setShowMemory(true);
    setShowAdmin(false);
    setIsSidebarOpen(false);
  }

  return (
    <div className={`app-shell${activeConv || showAdmin || showMemory ? ' has-active-chat' : ''}${isSidebarOpen ? ' sidebar-open' : ''}`}>
      <ConversationList
        activeId={activeConv}
        activityByConversation={conversationActivity}
        delegationByConversation={delegationByConversation}
        onSelect={selectConversation}
        onArchive={handleArchive}
        onOpenAdmin={openAdmin}
        onOpenMemory={openMemory}
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
      <div className="chat-instances" hidden={showAdmin || showMemory || !activeConv}>
        {mountedConversations.map(id => (
          <div key={id} className="chat-instance" hidden={showAdmin || showMemory || id !== activeConv}>
            <Chat
              conversationId={id}
              isVisible={!showAdmin && !showMemory && id === activeConv}
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
      ) : showMemory ? (
        <MemoryManager onBack={() => setShowMemory(false)} />
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
