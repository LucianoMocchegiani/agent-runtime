const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Campos temporales que pueden ordenar una página basada en cursor. */
export type CursorTimestampField = 'createdAt' | 'updatedAt';
/** Posición decodificada de una página: instante y UUID del último elemento. */
export type DecodedCursor = { timestamp: string; id: string };

/** Codifica en Base64URL una posición de paginación y el alcance de su filtro. */
/** Codifica una marca temporal, UUID y filtro en un cursor opaco Base64URL. */
export function encodeCursor(
  timestampField: CursorTimestampField,
  timestamp: string,
  id: string,
  scope: string,
): string {
  return Buffer.from(JSON.stringify({ [timestampField]: timestamp, id, scope }), 'utf8').toString('base64url');
}

/** Decodifica un cursor opcional y verifica fecha, UUID y alcance esperado. */
/** Valida y decodifica el cursor opcional, incluyendo su UUID, fecha y filtro esperado. */
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
