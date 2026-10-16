import ChatStyles from './ChatHeader.module.css';
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
    <header className={ChatStyles.chatHeader}>
      <button className={ChatStyles.mobileMenuButton} type="button" onClick={onOpenSidebar} aria-label="Abrir conversaciones" title="Abrir conversaciones"><Icon name="menu" /></button>
      <div className={ChatStyles.conversationHeading}>
        {isEditingTitle ? (
          <form className={ChatStyles.conversationTitleForm} onSubmit={saveConversationTitle}>
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
            <button type="submit" className={[ChatStyles.titleControl, ChatStyles.titleIconButton].join(' ')} disabled={isSavingTitle || !titleDraft.trim()} title="Guardar título" aria-label="Guardar título"><Icon name="save" /></button>
            <button type="button" className={[ChatStyles.titleControl, ChatStyles.titleIconButton].join(' ')} onClick={cancelEditingTitle} disabled={isSavingTitle} title="Cancelar edición" aria-label="Cancelar edición"><Icon name="close" /></button>
          </form>
        ) : (
          <>
            <span className={ChatStyles.conversationTitle} title={conversationTitle || 'Sin título'}>{conversationTitle || 'Sin título'}</span>
            <button type="button" className={[ChatStyles.titleEditButton, ChatStyles.titleIconButton].join(' ')} onClick={startEditingTitle} title="Cambiar título de la conversación" aria-label="Cambiar título de la conversación"><Icon name="edit" /></button>
          </>
        )}
        <span className={ChatStyles.conversationId} title={`ID: ${conversationId}`}>ID: {conversationId}</span>
        {agentProfiles.length > 0 && (
          <label className={ChatStyles.chatProfilePicker} title="Perfil usado en los próximos turnos">
            Agente
            <select value={agentProfileId} onChange={changeAgentProfile} disabled={isChangingProfile || isLoading}>
              {!agentProfiles.some(profile => profile.id === agentProfileId) && agentProfileId && <option value={agentProfileId}>Perfil archivado</option>}
              {agentProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <span className={ChatStyles.headerSpacer} />
      <div className={ChatStyles.toolbar}>
        {isPreparingVoice && <span role="status">Preparando audio…</span>}
        {voiceAudioUrl && !handsFreeMode && (
          <button type="button" onClick={isPlayingVoice ? () => stopVoicePlayback() : handleReplayVoice} title={isPlayingVoice ? 'Detener la respuesta hablada' : 'Reproducir la última respuesta hablada'}>
            {isPlayingVoice ? 'Detener voz' : 'Reproducir voz'}
          </button>
        )}
        <button  onClick={() => loadMessages({ preserveHistory: true })} disabled={isLoading} title="Actualizar los mensajes" aria-label="Actualizar los mensajes"><Icon name="refresh" /><span>Recargar</span></button>
      </div>
    </header>
  );
}
