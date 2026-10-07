/**
 * Errores del proveedor de IA / AI SDK → texto para el identificado. Sin secretos ni bodies crudos.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function collectBlob(error: unknown, depth = 0): string {
  if (depth > 4 || error == null) {
    return '';
  }
  const parts: string[] = [];
  if (typeof error === 'string') {
    parts.push(error);
  }
  if (error instanceof Error) {
    parts.push(error.name, error.message);
    const withCause = error as Error & { cause?: unknown };
    if (withCause.cause) {
      parts.push(collectBlob(withCause.cause, depth + 1));
    }
  }
  const rec = asRecord(error);
  if (rec) {
    for (const key of ['name', 'message', 'code', 'statusCode', 'status', 'responseBody'] as const) {
      const value = rec[key];
      if (typeof value === 'string' || typeof value === 'number') {
        parts.push(String(value));
      }
    }
    if (rec.error) {
      parts.push(collectBlob(rec.error, depth + 1));
    }
    if (rec.data) {
      parts.push(collectBlob(rec.data, depth + 1));
    }
  }
  return parts.join(' ').toLowerCase();
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message))) {
    return true;
  }
  const rec = asRecord(error);
  const name = rec && typeof rec.name === 'string' ? rec.name : '';
  return name === 'AbortError';
}

function errorPayload(event: unknown): unknown {
  const rec = asRecord(event);
  return rec?.error ?? event;
}

/**
 * Mensaje corto para el drawer / SSE `error`. Cadena vacía = abort (no mostrar).
 */
export function identifiedFacingLlmError(event: unknown, provider: string): string {
  const error = errorPayload(event);
  if (isAbortError(error) || isAbortError(event)) {
    return '';
  }
  const blob = collectBlob(error);
  if (
    blob.includes('402') ||
    blob.includes('insufficient') ||
    blob.includes('payment required') ||
    blob.includes('can afford') ||
    blob.includes('quota') ||
    /\bcredits?\b/.test(blob)
  ) {
    return `Se acabó el crédito de ${provider}. Recargá la cuenta o avisá a quien administra el sistema.`;
  }
  if (
    blob.includes('401') ||
    blob.includes('invalid api key') ||
    blob.includes('unauthorized') ||
    blob.includes('user not found')
  ) {
    return `La clave de ${provider} no es válida. Avisá a quien administra el sistema.`;
  }
  if (blob.includes('429') || blob.includes('rate limit') || blob.includes('too many requests')) {
    return `${provider} está saturado. Esperá un momento y reintentá.`;
  }
  if (
    blob.includes('context length') ||
    blob.includes('maximum context') ||
    blob.includes('context window') ||
    blob.includes('too many tokens')
  ) {
    return 'Este chat es muy largo para el modelo. Empezá uno nuevo.';
  }
  if (blob.includes('timeout') || blob.includes('timed out') || blob.includes('etimedout')) {
    return `${provider} tardó demasiado. Reintentá.`;
  }
  return 'El proveedor de IA no está disponible. Reintentá en un momento.';
}
