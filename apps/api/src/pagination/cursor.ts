const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CursorTimestampField = 'createdAt' | 'updatedAt';
export type DecodedCursor = { timestamp: string; id: string };

export function encodeCursor(
  timestampField: CursorTimestampField,
  timestamp: string,
  id: string,
  scope: string,
): string {
  return Buffer.from(JSON.stringify({ [timestampField]: timestamp, id, scope }), 'utf8').toString('base64url');
}

export function decodeOptionalCursor(
  cursor: string | undefined,
  timestampField: CursorTimestampField,
  expectedScope: string,
): DecodedCursor | undefined {
  if (cursor === undefined || cursor.trim() === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid cursor');
    const value = parsed as Record<string, unknown>;
    const timestamp = value[timestampField];
    if (typeof timestamp !== 'string'
      || !Number.isFinite(Date.parse(timestamp))
      || typeof value.id !== 'string'
      || !UUID_PATTERN.test(value.id)
      || value.scope !== expectedScope) {
      throw new Error('invalid cursor');
    }
    return { timestamp, id: value.id };
  } catch {
    throw new Error('El cursor no es válido o no coincide con el filtro actual.');
  }
}
