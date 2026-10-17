import ChatStyles from './ChatComposer.module.css';

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

  messageInputRef,

  input,

  handleInputChange,

  handlePaste,

  handleInputKeyDown,

  handleAbort,

}) {

  return (

    <form onSubmit={onSubmit} className={ChatStyles.composer}>

      {editingMessage && (

        <div className={ChatStyles.messageEditNotice} role="status">

          <div>

            <strong>Editando mensaje</strong>

            <span>Al reenviar se reemplazará y se eliminarán las respuestas posteriores.</span>

          </div>

          <button type="button" className={ChatStyles.messageEditCancel} onClick={cancelEditingMessage} disabled={isLoading}>Cancelar</button>

        </div>

      )}

      {images.length > 0 && (

        <div className={ChatStyles.imageAttachmentsPreview}>

          {images.map((image, index) => (

            <div className={ChatStyles.imageAttachmentPreview} key={`${image.name}-${index}`}>

              <img src={image.dataUrl} alt={`Vista previa: ${image.name}`} />

              <div className={ChatStyles.imageAttachmentDetails}>

                <span className={ChatStyles.attachmentType}>Imagen {index + 1}</span>

                <span className={ChatStyles.attachmentName} title={image.name}>{image.name}</span>

                <small>No se guardará en el historial</small>

              </div>

              <button type="button" onClick={() => removeImage(index)} disabled={isLoading} aria-label={`Quitar ${image.name}`} title="Quitar imagen"><Icon name="close" /></button>

            </div>

          ))}

        </div>

      )}

      <input

        ref={imageFileInputRef}

        className={ChatStyles.attachmentFileInput}

        type="file"

        accept="image/jpeg,image/png,image/webp,image/gif"

        multiple

        onChange={handleFileSelection}

        tabIndex={-1}

        aria-hidden="true"

      />

      <div className={ChatStyles.composerRow}>

        <div className={ChatStyles.attachmentMenuWrap} ref={attachmentMenuRef}>

          <button

            type="button"

            className={ChatStyles.attachButton}

            disabled={isLoading || isDelegatedActive || Boolean(editingMessage) || handsFreeMode}

            aria-haspopup="menu"

            aria-expanded={isAttachMenuOpen}

            title={images.length > 0 ? `Adjuntar archivo (${images.length}/${MAX_IMAGES})` : 'Adjuntar un archivo'}

            aria-label={images.length > 0 ? `Adjuntar archivo (${images.length} de ${MAX_IMAGES})` : 'Adjuntar un archivo'}

            onClick={() => setIsAttachMenuOpen(open => !open)}

          >

            <Icon name="attach" />

          </button>

          {isAttachMenuOpen && (

            <div className={ChatStyles.attachmentMenu} role="menu" aria-label="Tipo de archivo">

              <button type="button" role="menuitem" title="Adjuntar una imagen" onClick={() => imageFileInputRef.current?.click()}>

                <Icon name="image" className={ChatStyles.attachmentMenuIcon} />

                <span>Imagen</span>

              </button>

            </div>

          )}

        </div>

      {voiceAvailable && <div className={ChatStyles.handsFreeControl}>

        <button

          type="button"

          className={`${ChatStyles.handsFreeButton} ${handsFreeMode ? ChatStyles.handsFreeActive : ''}`}

          onClick={() => toggleHandsFree({ isLoading, isDelegatedActive, editingMessage })}

          disabled={!handsFreeMode && (isLoading || isDelegatedActive || Boolean(editingMessage))}

          aria-pressed={handsFreeMode}

          title={handsFreeMode ? 'Finalizar la conversación hablada y apagar el micrófono' : 'Iniciar una conversación hablada sin tener que mantener apretado el botón'}

        >

          {handsFreeMode ? '■ Finalizar conversación' : '🎙 Conversación hablada'}

        </button>

        {handsFreeMode && <span className={`${ChatStyles.handsFreeStatus} ${ChatStyles[`handsFreeStatus${handsFreeStatus[0].toUpperCase()}${handsFreeStatus.slice(1)}`]}`} role="status" aria-live="polite">

          <span className={ChatStyles.handsFreeStatusDot} aria-hidden="true" />

          {handsFreeStatus === 'connecting' ? 'Conectando al micrófono…'

            : handsFreeStatus === 'listening' ? 'Escuchando. Hablá cuando quieras.'

              : handsFreeStatus === 'processing' ? 'Procesando tu mensaje…'

                : handsFreeStatus === 'speaking' ? 'El asistente está hablando…'

                  : 'Modo manos libres'}

        </span>}

      </div>}

        <textarea

          ref={messageInputRef}

          className={ChatStyles.messageInput}

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

        <button className={ChatStyles.sendButton} type="submit" disabled={isLoading || isDelegatedActive || handsFreeMode || (!input.trim() && images.length === 0)} title={editingMessage ? 'Guardar la edición y generar una respuesta nueva' : 'Enviar mensaje'} aria-label={editingMessage ? 'Guardar y reenviar mensaje editado' : 'Enviar mensaje'}><Icon name="send" /></button>

        <button className={ChatStyles.stopButton} type="button" disabled={!isLoading} onClick={handleAbort} title="Detener la respuesta" aria-label="Detener la respuesta"><Icon name="stop" /></button>

      </div>

      <small className={ChatStyles.messageLength} aria-label="Longitud del mensaje">

        {handsFreeMode

          ? 'La escucha se pausa mientras responde el asistente y se reanuda al terminar. Salí del modo para apagar el micrófono.'

          : `${input.length.toLocaleString('es-AR')} / ${MAX_MESSAGE_CHARS.toLocaleString('es-AR')} caracteres · el límite de contexto del modelo también aplica`}

      </small>

    </form>

  );

}
