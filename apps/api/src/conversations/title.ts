/**
 * Título automático del hilo: primer mensaje del identificado, una línea, recortado.
 *
 * @remarks No llama al LLM. Si el identificado edita el título (PATCH), no se pisa
 * porque solo se aplica con `title IS NULL`.
 */
import { AUTO_CONVERSATION_TITLE_MAX_LENGTH, DEFAULT_CONVERSATION_TITLE } from './constants.js';

/**
 * Deriva un título breve de una sola línea del primer mensaje del usuario.
 * @param text Texto original del mensaje.
 * @returns Título de hasta `AUTO_CONVERSATION_TITLE_MAX_LENGTH` caracteres.
 */
export function titleFromFirstMessage(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length === 0) {
    return DEFAULT_CONVERSATION_TITLE;
  }
  if (oneLine.length <= AUTO_CONVERSATION_TITLE_MAX_LENGTH) {
    return oneLine;
  }
  const cut = oneLine.slice(0, AUTO_CONVERSATION_TITLE_MAX_LENGTH);
  const space = cut.lastIndexOf(' ');
  const base = space > 24 ? cut.slice(0, space) : cut;
  return `${base.trimEnd()}…`;
}
