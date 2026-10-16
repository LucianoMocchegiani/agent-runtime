/** Error de dominio cuando un hilo no existe o no pertenece al usuario indicado. */
export class ConversationNotFoundError extends Error {
  constructor() {
    super('Conversation not found');
    this.name = 'ConversationNotFoundError';
  }
}
