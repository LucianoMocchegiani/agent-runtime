/** Error cuando el mensaje objetivo no existe, no es propio o no es editable. */
export class MessageNotEditableError extends Error {
  constructor(message = 'Message cannot be edited') {
    super(message);
    this.name = 'MessageNotEditableError';
  }
}

/** Error de concurrencia cuando cambió la cantidad de mensajes posteriores confirmada. */
export class MessageEditConflictError extends Error {
  constructor() {
    super('Conversation changed since the edit was confirmed');
    this.name = 'MessageEditConflictError';
  }
}

/** Error cuando un mensaje con adjuntos no persistidos no puede regenerarse con seguridad. */
export class MessageContainsUnstoredAttachmentError extends Error {
  constructor() {
    super('Messages with unstored attachments cannot be edited');
    this.name = 'MessageContainsUnstoredAttachmentError';
  }
}
