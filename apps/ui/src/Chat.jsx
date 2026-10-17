import ChatStyles from './Chat.module.css';
import { useState, useEffect } from 'react';
import { MessageList, ThinkingIndicator } from './ChatMessages.jsx';
import ChatHeader from './ChatHeader.jsx';
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
    onRecognizedSpeech: text => handleSubmit(null, text, true),
  });
  const {
    voiceAvailable, handsFreeMode, handsFreeStatus, voiceAudioUrl,
    isPreparingVoice, isPlayingVoice, stopVoicePlayback,
    toggleHandsFree, handleReplayVoice,
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
    return !isLoading && !handsFreeMode && pendingImageReads === 0
      && images.length === 0 && !message.pending && message.role === 'user';
  }

  useEffect(() => {
    onActivityChange?.(conversationId, isLoading ? activity : null);
  }, [activity, conversationId, isLoading, onActivityChange]);

  const isDelegatedActive = DELEGATION_ACTIVE_STATUSES.has(delegationStatus);

  return (
    <main className={ChatStyles.chatArea}>
      <ChatHeader
        onOpenSidebar={onOpenSidebar}
        isEditingTitle={isEditingTitle}
        titleDraft={titleDraft}
        setTitleDraft={setTitleDraft}
        cancelEditingTitle={cancelEditingTitle}
        isSavingTitle={isSavingTitle}
        saveConversationTitle={saveConversationTitle}
        conversationTitle={conversationTitle}
        startEditingTitle={startEditingTitle}
        conversationId={conversationId}
        agentProfiles={agentProfiles}
        agentProfileId={agentProfileId}
        changeAgentProfile={changeAgentProfile}
        isChangingProfile={isChangingProfile}
        isLoading={isLoading}
        voiceAudioUrl={voiceAudioUrl}
        handsFreeMode={handsFreeMode}
        isPlayingVoice={isPlayingVoice}
        stopVoicePlayback={stopVoicePlayback}
        handleReplayVoice={handleReplayVoice}
      />
      {isPreparingVoice && (
        <div className={ChatStyles.audioToast} role="status" aria-live="polite">
          <span className={ChatStyles.audioToastSpinner} aria-hidden="true" />
          <span>Generando audio…</span>
        </div>
      )}
      <div
        ref={scrollContainerRef}
        className={ChatStyles.messages}
        onScroll={handleMessagesScroll}
      >
        {isLoadingOlder && <div className={ChatStyles.historyLoading} role="status">Cargando mensajes anteriores…</div>}
        <MessageList messages={messages} onOpenConversation={onOpenConversation} onEditMessage={!isLoading && !isDelegatedActive && !handsFreeMode && images.length === 0 ? startEditingMessage : null} />
        {isLoading && (
          <div className={ChatStyles.thinkingSlot}>
            {activity === 'thinking' && <ThinkingIndicator />}
          </div>
        )}
      </div>
      {error && (
        <div className={ChatStyles.errorBar} role="alert">
          <span>{error}</span>
          {isHistoryStale && <button type="button" className={ChatStyles.errorRetryButton} onClick={retryHistoryLoad}>Actualizar historial</button>}
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
