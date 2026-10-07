import { useState } from 'react';
import ConversationList from './ConversationList.jsx';
import Chat from './Chat.jsx';
import client from './client.js';

export default function App() {
  const [activeConv, setActiveConv] = useState(null);

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#1a1a2e', color: '#e0e0e0', fontFamily: 'system-ui, sans-serif' }}>
      <ConversationList activeId={activeConv} onSelect={setActiveConv} />
      {activeConv ? (
        <Chat conversationId={activeConv} />
      ) : (
        <div id="empty-state">
          <div>Seleccioná un chat o creá uno nuevo</div>
          <button onClick={async () => {
            const conv = await client.conversations.create();
            setActiveConv(conv.id);
          }}>Nuevo chat</button>
        </div>
      )}
    </div>
  );
}