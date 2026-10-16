import type { JsonValue } from 'agent-runtime-memory/contracts';

/**
 * Convierte un valor a JSON, omitiendo `undefined` y serializando los valores no compatibles.
 * @param value Valor de origen, potencialmente no serializable.
 * @returns Valor JSON compatible o representación textual si la serialización falla.
 */
export function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    JSON.stringify(value);
    return value as JsonValue;
  } catch {
    return JSON.stringify(String(value));
  }
}
