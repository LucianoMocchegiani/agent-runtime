import { decodeOptionalCursor, encodeCursor } from '../pagination/cursor.js';

export type ConversationListScope = 'all' | 'active' | 'archived';

type CursorPayload = {
  updatedAt: string;
  id: string;
  scope: ConversationListScope;
};

export function encodeConversationCursor(payload: CursorPayload): string {
  return encodeCursor('updatedAt', payload.updatedAt, payload.id, payload.scope);
}

export function decodeOptionalConversationCursor(
  cursor: string | undefined,
  expectedScope: ConversationListScope,
): { updatedAt: string; id: string } | undefined {
  try {
    const decoded = decodeOptionalCursor(cursor, 'updatedAt', expectedScope);
    return decoded ? { updatedAt: decoded.timestamp, id: decoded.id } : undefined;
  } catch {
    throw new Error('El cursor de conversaciones no es válido o no coincide con el filtro actual.');
  }
}

export function decodeConversationCursor(
  cursor: string,
  expectedScope: ConversationListScope,
): { updatedAt: string; id: string } {
  const decoded = decodeOptionalConversationCursor(cursor, expectedScope);
  if (!decoded) throw new Error('El cursor de conversaciones no es válido o no coincide con el filtro actual.');
  return decoded;
}
