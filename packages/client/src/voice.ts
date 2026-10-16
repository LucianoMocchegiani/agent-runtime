import { ClientError } from './client-error.js';
import { apiBaseUrl, apiHeaders, parseJson } from './http.js';
import type { ClientConfig } from './types.js';

/** Construye las operaciones de voz disponibles para una conversación. */
export function createVoiceApi(config: ClientConfig) {
  return {
    /**
     * Consulta si la síntesis de voz está disponible.
     * @throws {ClientError} Si falla la solicitud.
     */
    status: async (conversationId: string): Promise<{ available: boolean }> => {
      const res = await fetch(`${apiBaseUrl(config)}/v1/conversations/${encodeURIComponent(conversationId)}/voice/status`, {
        headers: apiHeaders(config, { Accept: 'application/json' }),
      });
      if (!res.ok) throw new ClientError(res.status, `No se pudo consultar la disponibilidad de voz (HTTP ${res.status}).`);
      return parseJson<{ available: boolean }>(res);
    },

    /** Solicita una credencial Realtime temporal para transcripción. @throws {ClientError} Si falla la solicitud. */
    createRealtimeToken: async (conversationId: string): Promise<{ value: string; expiresAt: number | null }> => {
      const res = await fetch(`${apiBaseUrl(config)}/v1/conversations/${encodeURIComponent(conversationId)}/voice/token`, {
        method: 'POST',
        headers: apiHeaders(config, { Accept: 'application/json' }),
      });
      if (!res.ok) {
        const data = await parseJson<{ error?: string; message?: string }>(res);
        throw new ClientError(res.status, data?.error ?? data?.message ?? `No se pudo iniciar la voz (HTTP ${res.status}).`);
      }
      return parseJson<{ value: string; expiresAt: number | null }>(res);
    },

    /**
     * Convierte texto en audio y devuelve el resultado como `Blob`.
     * @param conversationId Conversación a la que pertenece la solicitud.
     * @param text Texto que se sintetizará.
     * @param traceId Identificador opcional para correlacionar la solicitud de voz.
     * @returns Audio generado por el servidor.
     * @throws {ClientError} Si la respuesta HTTP no es exitosa.
     */
    synthesize: async (conversationId: string, text: string, traceId?: string): Promise<Blob> => {
      const requestHeaders = apiHeaders(config, { 'Content-Type': 'application/json', Accept: 'audio/mpeg' });
      if (traceId) requestHeaders['X-Voice-Trace-Id'] = traceId;
      const res = await fetch(`${apiBaseUrl(config)}/v1/conversations/${encodeURIComponent(conversationId)}/voice/speech`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = await parseJson<{ error?: string; message?: string }>(res);
        throw new ClientError(res.status, data?.error ?? data?.message ?? `No se pudo generar la voz (HTTP ${res.status}).`);
      }
      return res.blob();
    },
  };
}
