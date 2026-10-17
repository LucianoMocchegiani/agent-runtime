import { useState } from 'react';
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
  voiceAudioUrl,
  handsFreeMode,
  isPlayingVoice,
  stopVoicePlayback,
  handleReplayVoice,
}) {
  const [titleWidth, setTitleWidth] = useState(null);

  return (
    <header className={ChatStyles.chatHeader}>
      <button className={ChatStyles.mobileMenuButton} type="button" onClick={onOpenSidebar} aria-label="Abrir conversaciones" title="Abrir conversaciones"><Icon name="menu" /></button>
      <div className={ChatStyles.conversationHeading}>
        {isEditingTitle ? (
          <form className={ChatStyles.conversationTitleForm} style={titleWidth ? { width: `${titleWidth}px` } : undefined} onSubmit={saveConversationTitle}>
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
            <div className={ChatStyles.titleFormControls}>
              <button type="submit" className={ChatStyles.titleControl} disabled={isSavingTitle || !titleDraft.trim()} title="Guardar título" aria-label="Guardar título"><Icon name="save" /></button>
              <button type="button" className={ChatStyles.titleControl} onClick={cancelEditingTitle} disabled={isSavingTitle} title="Cancelar edición" aria-label="Cancelar edición"><Icon name="close" /></button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className={ChatStyles.conversationTitle}
            onClick={event => {
              setTitleWidth(event.currentTarget.getBoundingClientRect().width);
              startEditingTitle();
            }}
            title="Editar título de la conversación"
            aria-label={`Editar título: ${conversationTitle || 'Sin título'}`}
          >
            {conversationTitle || 'Sin título'}
          </button>
        )}
        <code className={ChatStyles.conversationId} title={`ID de conversación: ${conversationId}`}>{conversationId}</code>
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
        {voiceAudioUrl && !handsFreeMode && (
          <button type="button" onClick={isPlayingVoice ? () => stopVoicePlayback() : handleReplayVoice} title={isPlayingVoice ? 'Detener la respuesta hablada' : 'Reproducir la última respuesta hablada'}>
            {isPlayingVoice ? 'Detener voz' : 'Reproducir voz'}
          </button>
        )}
      </div>
    </header>
  );
}
