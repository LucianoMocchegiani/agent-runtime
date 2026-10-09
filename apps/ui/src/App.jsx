import { useState } from 'react';
import ConversationList from './ConversationList.jsx';
import Chat from './Chat.jsx';
import client from './client.js';
import Icon from './Icon.jsx';
import AdminConfig from './AdminConfig.jsx';

export default function App() {
  const [activeConv, setActiveConv] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  function selectConversation(id) {
    setActiveConv(id);
    setShowAdmin(false);
    setIsSidebarOpen(false);
  }

  function openAdmin() {
    setShowAdmin(true);
    setIsSidebarOpen(false);
  }

  return (
    <div className={`app-shell${activeConv || showAdmin ? ' has-active-chat' : ''}${isSidebarOpen ? ' sidebar-open' : ''}`}>
      <ConversationList activeId={activeConv} onSelect={selectConversation} onOpenAdmin={openAdmin} />
      {isSidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Cerrar conversaciones"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      {showAdmin ? (
        <AdminConfig onBack={() => setShowAdmin(false)} />
      ) : activeConv ? (
        <Chat conversationId={activeConv} onOpenSidebar={() => setIsSidebarOpen(true)} />
      ) : (
        <div id="empty-state">
          <div>Seleccioná un chat o creá uno nuevo</div>
          <button onClick={async () => {
            const conv = await client.conversations.create();
            selectConversation(conv.id);
          }} title="Crear una conversación nueva"><Icon name="plus" /><span>Nuevo chat</span></button>
        </div>
      )}
    </div>
  );
}
