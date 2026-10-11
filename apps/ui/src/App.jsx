import { useCallback, useState } from 'react';
import ConversationList from './ConversationList.jsx';
import Chat from './Chat.jsx';
import client from './client.js';
import Icon from './Icon.jsx';
import AdminConfig from './AdminConfig.jsx';

export default function App() {
  const [activeConv, setActiveConv] = useState(null);
  const [mountedConversations, setMountedConversations] = useState([]);
  const [conversationActivity, setConversationActivity] = useState({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [conversationRefreshKey, setConversationRefreshKey] = useState(0);
  const refreshConversations = useCallback(() => setConversationRefreshKey(key => key + 1), []);

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
              onOpenSidebar={() => setIsSidebarOpen(true)}
              onConversationUpdated={refreshConversations}
              onActivityChange={updateConversationActivity}
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
