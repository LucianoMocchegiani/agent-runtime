import { HTTPException } from 'hono/http-exception';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida UUID de conversación en la ruta.
 *
 * @throws {HTTPException} 400 si falta o no es UUID.
 */
export function requireConversationId(id: string | undefined): string {
  if (!id || !UUID_RE.test(id)) {
    throw new HTTPException(400, { message: 'Invalid conversation id' });
  }
  return id;
}
