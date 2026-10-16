import Icon from './Icon.jsx';

export default function ChatHeader({
  onOpenSidebar,
  isEditingTitle,
  titleDraft,
  setTitleDraft,
  cancelEditingTitle,
  isSavingTitle,
  saveConversationTitle,
  conversationTitle,
  startEditingTitle,
  conversationId,
  agentProfiles,
  agentProfileId,
  changeAgentProfile,
  isChangingProfile,
  isLoading,
  isPreparingVoice,
  voiceAudioUrl,
  handsFreeMode,
  isPlayingVoice,
  stopVoicePlayback,
  handleReplayVoice,
  loadMessages,
}) {
  return (
    <header className="chat-header">
      <button className="mobile-menu-button" type="button" onClick={onOpenSidebar} aria-label="Abrir conversaciones" title="Abrir conversaciones"><Icon name="menu" /></button>
      <div className="conversation-heading">
        {isEditingTitle ? (
          <form className="conversation-title-form" onSubmit={saveConversationTitle}>
            <input
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') cancelEditingTitle(); }}
              maxLength={200}
              required
              placeholder="Título de la conversación"
              aria-label="Título de la conversación"
              disabled={isSavingTitle}
            />
            <button type="submit" className="title-control title-icon-button" disabled={isSavingTitle || !titleDraft.trim()} title="Guardar título" aria-label="Guardar título"><Icon name="save" /></button>
            <button type="button" className="title-control title-icon-button" onClick={cancelEditingTitle} disabled={isSavingTitle} title="Cancelar edición" aria-label="Cancelar edición"><Icon name="close" /></button>
          </form>
        ) : (
          <>
            <span className="conversation-title" title={conversationTitle || 'Sin título'}>{conversationTitle || 'Sin título'}</span>
            <button type="button" className="title-edit-button title-icon-button" onClick={startEditingTitle} title="Cambiar título de la conversación" aria-label="Cambiar título de la conversación"><Icon name="edit" /></button>
          </>
        )}
        <span className="conversation-id" title={`ID: ${conversationId}`}>ID: {conversationId}</span>
        {agentProfiles.length > 0 && (
          <label className="chat-profile-picker" title="Perfil usado en los próximos turnos">
            Agente
            <select value={agentProfileId} onChange={changeAgentProfile} disabled={isChangingProfile || isLoading}>
              {!agentProfiles.some(profile => profile.id === agentProfileId) && agentProfileId && <option value={agentProfileId}>Perfil archivado</option>}
              {agentProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <span className="header-spacer" />
      <div className="toolbar">
        {isPreparingVoice && <span role="status">Preparando audio…</span>}
        {voiceAudioUrl && !handsFreeMode && (
          <button type="button" onClick={isPlayingVoice ? () => stopVoicePlayback() : handleReplayVoice} title={isPlayingVoice ? 'Detener la respuesta hablada' : 'Reproducir la última respuesta hablada'}>
            {isPlayingVoice ? 'Detener voz' : 'Reproducir voz'}
          </button>
        )}
        <button className="reload-button" onClick={() => loadMessages({ preserveHistory: true })} disabled={isLoading} title="Actualizar los mensajes" aria-label="Actualizar los mensajes"><Icon name="refresh" /><span>Recargar</span></button>
      </div>
    </header>
  );
}
