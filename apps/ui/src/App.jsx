import { useCallback, useState } from 'react';
import ConversationList from './ConversationList.jsx';
import ChatStyles from './App.module.css';
import Chat from './Chat.jsx';
import client from './client.js';
import Icon from './Icon.jsx';
import AdminConfig from './AdminConfig.jsx';
import MemoryManager from './MemoryManager.jsx';
import IdentitySettings from './IdentitySettings.jsx';
import McpConnections from './McpConnections.jsx';
import useDelegationTracking from './useDelegationTracking.js';

export default function App() {
  const [activeConv, setActiveConv] = useState(null);
  const [mountedConversations, setMountedConversations] = useState([]);
  const [conversationActivity, setConversationActivity] = useState({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showIdentity, setShowIdentity] = useState(false);
  const [showMcpConnections, setShowMcpConnections] = useState(() => Boolean(new URLSearchParams(window.location.search).get('mcp-oauth')));
  const [identityRevision, setIdentityRevision] = useState(0);
  const [conversationRefreshKey, setConversationRefreshKey] = useState(0);
  const refreshConversations = useCallback(() => setConversationRefreshKey(key => key + 1), []);
  const { delegationByConversation, refreshDelegations } = useDelegationTracking();

  const handleConversationUpdated = useCallback(() => {
    refreshConversations();
    void refreshDelegations();
  }, [refreshConversations, refreshDelegations]);

  const handleIdentityChanged = useCallback(() => {
    setIdentityRevision(revision => revision + 1);
    refreshConversations();
  }, [refreshConversations]);

  function selectConversation(id) {
    setActiveConv(id);
    if (id) {
      setMountedConversations(current => current.includes(id) ? current : [...current, id]);
    }
    setShowAdmin(false);
    setShowMemory(false);
    setShowIdentity(false);
    setShowMcpConnections(false);
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
    setShowIdentity(false);
    setShowMcpConnections(false);
    setIsSidebarOpen(false);
  }

  function openMemory() {
    setShowMemory(true);
    setShowAdmin(false);
    setShowIdentity(false);
    setShowMcpConnections(false);
    setIsSidebarOpen(false);
  }

  function openIdentity() {
    setShowIdentity(true);
    setShowAdmin(false);
    setShowMemory(false);
    setShowMcpConnections(false);
    setIsSidebarOpen(false);
  }

  function openMcpConnections() {
    setShowMcpConnections(true);
    setShowAdmin(false);
    setShowMemory(false);
    setShowIdentity(false);
    setIsSidebarOpen(false);
  }

  return (
    <div className={ChatStyles.appShell}>
      <ConversationList
        isSidebarOpen={isSidebarOpen}
        hasActiveChat={Boolean(activeConv || showAdmin || showMemory || showIdentity || showMcpConnections)}
        activeId={activeConv}
        activityByConversation={conversationActivity}
        delegationByConversation={delegationByConversation}
        onSelect={selectConversation}
        onArchive={handleArchive}
        onOpenAdmin={openAdmin}
        onOpenMemory={openMemory}
        onOpenIdentity={openIdentity}
        onOpenMcpConnections={openMcpConnections}
        refreshKey={conversationRefreshKey}
      />
      {isSidebarOpen && (
        <button
          type="button"
          className={ChatStyles.sidebarBackdrop}
          aria-label="Cerrar conversaciones"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <div className={ChatStyles.chatInstances} hidden={showAdmin || showMemory || showIdentity || showMcpConnections || !activeConv}>
        {mountedConversations.map(id => (
          <div key={`${id}:${identityRevision}`} className={ChatStyles.chatInstance} hidden={showAdmin || showMemory || showIdentity || showMcpConnections || id !== activeConv}>
            <Chat
              conversationId={id}
              isVisible={!showAdmin && !showMemory && !showIdentity && !showMcpConnections && id === activeConv}
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
      ) : showIdentity ? (
        <IdentitySettings onBack={() => setShowIdentity(false)} onBearerChange={handleIdentityChanged} />
      ) : showMcpConnections ? (
        <McpConnections onBack={() => setShowMcpConnections(false)} />
      ) : !activeConv ? (
        <div className={ChatStyles.emptyState}>
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
