export type ConversationListScope = 'all' | 'active' | 'archived';

type CursorPayload = {
  updatedAt: string;
  id: string;
  scope: ConversationListScope;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeConversationCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeOptionalConversationCursor(
  cursor: string | undefined,
  expectedScope: ConversationListScope,
): { updatedAt: string; id: string } | undefined {
  if (cursor === undefined || cursor.trim() === '') return undefined;
  return decodeConversationCursor(cursor, expectedScope);
}

export function decodeConversationCursor(
  cursor: string,
  expectedScope: ConversationListScope,
): { updatedAt: string; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('invalid cursor');
    }
    const value = parsed as Record<string, unknown>;
    if (typeof value.updatedAt !== 'string'
      || !Number.isFinite(Date.parse(value.updatedAt))
      || typeof value.id !== 'string'
      || !UUID_PATTERN.test(value.id)
      || value.scope !== expectedScope) {
      throw new Error('invalid cursor');
    }
    return { updatedAt: value.updatedAt, id: value.id };
  } catch {
    throw new Error('El cursor de conversaciones no es válido o no coincide con el filtro actual.');
  }
}
