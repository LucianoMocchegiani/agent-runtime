import { useState, useEffect } from 'react';
import Icon from './Icon.jsx';
import { MessageList, ThinkingIndicator } from './ChatMessages.jsx';
import useConversationSettings from './useConversationSettings.js';
import useChatAttachments from './useChatAttachments.js';
import useChatVoice from './useChatVoice.js';
import useChatHistory from './useChatHistory.js';
import useChatTurn, { DELEGATION_ACTIVE_STATUSES } from './useChatTurn.js';
import useChatComposer from './useChatComposer.js';
import ChatComposer from './ChatComposer.jsx';
export default function Chat({ conversationId, isVisible, delegationStatus, onOpenSidebar, onConversationUpdated, onActivityChange, onOpenConversation }) {
  const [error, setError] = useState(null);
  const {
    conversationTitle,
    agentProfileId,
    agentProfiles,
    isChangingProfile,
    titleDraft,
    setTitleDraft,
    isEditingTitle,
    isSavingTitle,
    refreshConversation,
    changeAgentProfile,
    saveConversationTitle,
    startEditingTitle,
    cancelEditingTitle,
  } = useConversationSettings({ conversationId, onConversationUpdated, onError: setError });
  const {
    images,
    pendingImageReads,
    isAttachMenuOpen,
    setIsAttachMenuOpen,
    clearImages,
    removeImage,
    handlePaste,
    handleFileSelection,
    addLocalImagePreviews,
    rememberLocalImagePreview,
    imageFileInputRef,
    attachmentMenuRef,
  } = useChatAttachments({ setError });
  const {
    messages,
    setMessages,
    loadMessages,
    isLoadingOlder,
    isHistoryStale,
    setIsHistoryStale,
    scrollContainerRef,
    handleMessagesScroll,
    retryHistoryLoad,
  } = useChatHistory({ conversationId, isVisible, delegationStatus, addLocalImagePreviews, setError });
  const voice = useChatVoice({
    conversationId,
    isVisible,
    onError: setError,
    onSubmitTranscript: text => handleSubmit(null, text, true),
  });
  const {
    voiceState, voiceAvailable, handsFreeMode, handsFreeStatus, voiceAudioUrl,
    isPreparingVoice, isPlayingVoice, stopVoicePlayback,
    toggleHandsFree, handleVoiceButton, handleReplayVoice, handleCancelVoice,
  } = voice;
  const {
    input,
    setInput,
    editingMessage,
    setEditingMessage,
    inputBeforeEditRef,
    messageInputRef,
    handleInputChange,
    handleInputKeyDown,
    startEditingMessage,
    cancelEditingMessage,
  } = useChatComposer({
    conversationId,
    canStartEditingMessage,
    onClearError: () => setError(null),
  });
  const {
    isLoading,
    activity,
    handleSubmit,
    handleAbort,
  } = useChatTurn({
    conversationId,
    delegationStatus,
    messages,
    setMessages,
    loadMessages,
    setIsHistoryStale,
    refreshConversation,
    setError,
    input,
    setInput,
    editingMessage,
    setEditingMessage,
    inputBeforeEditRef,
    images,
    clearImages,
    pendingImageReads,
    rememberLocalImagePreview,
    voice,
  });

  function canStartEditingMessage(message) {
    return !isLoading && voiceState === 'idle' && pendingImageReads === 0
      && images.length === 0 && !message.pending && message.role === 'user';
  }

  useEffect(() => {
    onActivityChange?.(conversationId, isLoading ? activity : null);
  }, [activity, conversationId, isLoading, onActivityChange]);

  const isDelegatedActive = DELEGATION_ACTIVE_STATUSES.has(delegationStatus);

  return (
    <main className="chat-area">
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
      <div
        ref={scrollContainerRef}
        className="messages"
        onScroll={handleMessagesScroll}
      >
        {isLoadingOlder && <div className="history-loading" role="status">Cargando mensajes anteriores…</div>}
        <MessageList messages={messages} onOpenConversation={onOpenConversation} onEditMessage={!isLoading && !isDelegatedActive && !handsFreeMode && voiceState === 'idle' && images.length === 0 ? startEditingMessage : null} />
        {isLoading && (
          <div className="thinking-slot">
            {activity === 'thinking' && <ThinkingIndicator />}
          </div>
        )}
      </div>
      {error && (
        <div className="error-bar" role="alert">
          <span>{error}</span>
          {isHistoryStale && <button type="button" className="error-retry-button" onClick={retryHistoryLoad}>Actualizar historial</button>}
        </div>
      )}
      <ChatComposer
        onSubmit={handleSubmit}
        editingMessage={editingMessage}
        cancelEditingMessage={cancelEditingMessage}
        isLoading={isLoading}
        images={images}
        removeImage={removeImage}
        imageFileInputRef={imageFileInputRef}
        handleFileSelection={handleFileSelection}
        voiceAvailable={voiceAvailable}
        handsFreeMode={handsFreeMode}
        toggleHandsFree={toggleHandsFree}
        isDelegatedActive={isDelegatedActive}
        handsFreeStatus={handsFreeStatus}
        setIsAttachMenuOpen={setIsAttachMenuOpen}
        isAttachMenuOpen={isAttachMenuOpen}
        attachmentMenuRef={attachmentMenuRef}
        voiceState={voiceState}
        handleVoiceButton={handleVoiceButton}
        handleCancelVoice={handleCancelVoice}
        messageInputRef={messageInputRef}
        input={input}
        handleInputChange={handleInputChange}
        handlePaste={handlePaste}
        handleInputKeyDown={handleInputKeyDown}
        handleAbort={handleAbort}
      />
    </main>
  );
}
