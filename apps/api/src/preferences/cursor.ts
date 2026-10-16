import { decodeOptionalCursor, encodeCursor } from '../pagination/cursor.js';
import { PREFERENCE_CURSOR_SCOPE } from './constants.js';

/** Codifica la posición de una página de preferencias. */
export function encodePreferenceCursor(payload: { createdAt: string; id: string }): string {
  return encodeCursor('createdAt', payload.createdAt, payload.id, PREFERENCE_CURSOR_SCOPE);
}

/** Decodifica un cursor opcional de preferencias; rechaza formatos inválidos. */
export function decodeOptionalPreferenceCursor(
  cursor: string | undefined,
): { createdAt: string; id: string } | undefined {
  try {
    const decoded = decodeOptionalCursor(cursor, 'createdAt', PREFERENCE_CURSOR_SCOPE);
    return decoded ? { createdAt: decoded.timestamp, id: decoded.id } : undefined;
  } catch {
    throw new Error('El cursor de preferencias no es válido.');
  }
}
