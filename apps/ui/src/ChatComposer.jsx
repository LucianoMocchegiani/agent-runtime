import Icon from './Icon.jsx';
import { MAX_IMAGES } from './useChatAttachments.js';
import { MAX_MESSAGE_CHARS } from './useChatComposer.js';

export default function ChatComposer({
  onSubmit,
  editingMessage,
  cancelEditingMessage,
  isLoading,
  images,
  removeImage,
  imageFileInputRef,
  handleFileSelection,
  voiceAvailable,
  handsFreeMode,
  toggleHandsFree,
  isDelegatedActive,
  handsFreeStatus,
  setIsAttachMenuOpen,
  isAttachMenuOpen,
  attachmentMenuRef,
  voiceState,
  handleVoiceButton,
  handleCancelVoice,
  messageInputRef,
  input,
  handleInputChange,
  handlePaste,
  handleInputKeyDown,
  handleAbort,
}) {
  return (
    <form onSubmit={onSubmit} className="composer">
      {editingMessage && (
        <div className="message-edit-notice" role="status">
          <div>
            <strong>Editando mensaje</strong>
            <span>Al reenviar se reemplazará y se eliminarán las respuestas posteriores.</span>
          </div>
          <button type="button" className="message-edit-cancel" onClick={cancelEditingMessage} disabled={isLoading}>Cancelar</button>
        </div>
      )}
      {images.length > 0 && (
        <div className="image-attachments-preview">
          {images.map((image, index) => (
            <div className="image-attachment-preview" key={`${image.name}-${index}`}>
              <img src={image.dataUrl} alt={`Vista previa: ${image.name}`} />
              <div className="image-attachment-details">
                <span className="attachment-type">Imagen {index + 1}</span>
                <span className="attachment-name" title={image.name}>{image.name}</span>
                <small>No se guardará en el historial</small>
              </div>
              <button type="button" onClick={() => removeImage(index)} disabled={isLoading} aria-label={`Quitar ${image.name}`} title="Quitar imagen"><Icon name="close" /></button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={imageFileInputRef}
        className="attachment-file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        onChange={handleFileSelection}
        tabIndex={-1}
        aria-hidden="true"
      />
      {voiceAvailable && <div className="hands-free-control">
        <button
          type="button"
          className={`hands-free-button${handsFreeMode ? ' hands-free-active' : ''}`}
          onClick={() => toggleHandsFree({ isLoading, isDelegatedActive, editingMessage })}
          disabled={!handsFreeMode && (isLoading || isDelegatedActive || Boolean(editingMessage) || voiceState !== 'idle')}
          aria-pressed={handsFreeMode}
          title={handsFreeMode ? 'Salir del modo manos libres y apagar el micrófono' : 'Activar conversación por voz sin tener que apretar para hablar'}
        >
          {handsFreeMode ? '■ Salir de manos libres' : '🎙 Manos libres'}
        </button>
        {handsFreeMode && <span className={`hands-free-status hands-free-status-${handsFreeStatus}`} role="status" aria-live="polite">
          <span className="hands-free-status-dot" aria-hidden="true" />
          {handsFreeStatus === 'connecting' ? 'Conectando al micrófono…'
            : handsFreeStatus === 'listening' ? 'Escuchando. Hablá cuando quieras.'
              : handsFreeStatus === 'processing' ? 'Procesando tu mensaje…'
                : handsFreeStatus === 'speaking' ? 'El asistente está hablando…'
                  : 'Modo manos libres'}
        </span>}
      </div>}
      <div className="composer-row">
        <div className="attachment-menu-wrap" ref={attachmentMenuRef}>
          <button
            type="button"
            className="attach-button"
            disabled={isLoading || isDelegatedActive || Boolean(editingMessage) || handsFreeMode}
            aria-haspopup="menu"
            aria-expanded={isAttachMenuOpen}
            title="Adjuntar un archivo"
            onClick={() => setIsAttachMenuOpen(open => !open)}
          >
            <Icon name="attach" />
            Adjuntar{images.length > 0 ? ` (${images.length}/${MAX_IMAGES})` : ''}
          </button>
          {isAttachMenuOpen && (
            <div className="attachment-menu" role="menu" aria-label="Tipo de archivo">
              <button type="button" role="menuitem" title="Adjuntar una imagen" onClick={() => imageFileInputRef.current?.click()}>
                <Icon name="image" className="attachment-menu-icon" />
                <span>Imagen</span>
              </button>
            </div>
          )}
        </div>
        {voiceAvailable && !handsFreeMode && <button
          className={`voice-button${voiceState === 'listening' ? ' voice-listening' : ''}`}
          type="button"
          onClick={handleVoiceButton}
          disabled={isLoading || isDelegatedActive || Boolean(editingMessage) || voiceState === 'transcribing'}
          title={voiceState === 'idle' ? 'Hablar por voz' : voiceState === 'connecting' ? 'Conectando con reconocimiento de voz' : voiceState === 'transcribing' ? 'Esperando la transcripción de voz' : 'Terminar de hablar y enviar'}
          aria-label={voiceState === 'idle' ? 'Hablar por voz' : voiceState === 'connecting' ? 'Conectando con reconocimiento de voz' : voiceState === 'transcribing' ? 'Procesando voz' : 'Terminar de hablar y enviar'}
        >
          {voiceState === 'idle' ? '🎙 Hablar' : voiceState === 'connecting' ? 'Conectando…' : voiceState === 'transcribing' ? 'Procesando…' : 'Enviar voz'}
        </button>}
        {voiceAvailable && !handsFreeMode && voiceState !== 'idle' && <button
          className="voice-cancel-button"
          type="button"
          onClick={handleCancelVoice}
          title="Cancelar y descartar la grabación de voz"
          aria-label="Cancelar y descartar la grabación de voz"
        >
          Cancelar
        </button>}
        <textarea
          ref={messageInputRef}
          className="message-input"
          value={input}
          onChange={handleInputChange}
          onPaste={event => handlePaste(event, isLoading || Boolean(editingMessage))}
          onKeyDown={handleInputKeyDown}
          placeholder={editingMessage ? 'Editá el mensaje y reenviá...' : 'Escribí un mensaje...'}
          disabled={isLoading || isDelegatedActive || handsFreeMode}
          maxLength={MAX_MESSAGE_CHARS}
          rows={1}
          aria-label="Mensaje"
        />
        <button className="send-button" type="submit" disabled={isLoading || isDelegatedActive || handsFreeMode || (!input.trim() && images.length === 0)} title={editingMessage ? 'Guardar la edición y generar una respuesta nueva' : 'Enviar mensaje'} aria-label={editingMessage ? 'Guardar y reenviar mensaje editado' : 'Enviar mensaje'}><Icon name="send" /><span>{editingMessage ? 'Guardar y reenviar' : 'Enviar'}</span></button>
        <button className="stop-button" type="button" disabled={!isLoading} onClick={handleAbort} title="Detener la respuesta" aria-label="Detener la respuesta"><Icon name="stop" /><span>Parar</span></button>
      </div>
      <small className="message-length" aria-label="Longitud del mensaje">
        {handsFreeMode
          ? 'La escucha se pausa mientras responde el asistente y se reanuda al terminar. Salí del modo para apagar el micrófono.'
          : voiceState === 'listening'
            ? 'Escuchando. Tocá «Enviar voz» para enviar o «Cancelar» para descartarla.'
            : voiceState === 'connecting'
              ? 'Conectando con el reconocimiento de voz… Tocá «Cancelar» para salir.'
              : voiceState === 'transcribing'
                ? 'Procesando la transcripción… Podés cancelarla antes de que se envíe.'
                : `${input.length.toLocaleString('es-AR')} / ${MAX_MESSAGE_CHARS.toLocaleString('es-AR')} caracteres · el límite de contexto del modelo también aplica`}
      </small>
    </form>
  );
}
