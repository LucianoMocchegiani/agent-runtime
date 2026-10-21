import { ClientError } from './client-error.js';
import { apiBaseUrl, apiHeaders, parseJson } from './http.js';
import type { ClientConfig } from './types.js';

/** Construye las operaciones Realtime disponibles para una conversación. */
export function createVoiceApi(config: ClientConfig) {
  return {
    /** Consulta si hay un perfil Realtime habilitado para la conversación. */
    status: async (conversationId: string): Promise<{ available: boolean }> => {
      const res = await fetch(`${apiBaseUrl(config)}/v1/conversations/${encodeURIComponent(conversationId)}/voice/status`, {
        headers: apiHeaders(config, { Accept: 'application/json' }),
      });
      if (!res.ok) throw new ClientError(res.status, `No se pudo consultar la disponibilidad de voz (HTTP ${res.status}).`);
      return parseJson<{ available: boolean }>(res);
    },

    /** Solicita credencial efímera para conectar audio WebRTC con Realtime; la clave permanente no sale del backend. */
    createRealtimeSession: async (conversationId: string): Promise<{ value: string; expiresAt: number | null; realtimeUrl: string }> => {
      const res = await fetch(`${apiBaseUrl(config)}/v1/conversations/${encodeURIComponent(conversationId)}/voice/session`, {
        method: 'POST',
        headers: apiHeaders(config, { Accept: 'application/json' }),
      });
      if (!res.ok) {
        const data = await parseJson<{ error?: string; message?: string }>(res);
        throw new ClientError(res.status, data?.error ?? data?.message ?? `No se pudo iniciar la sesión de voz (HTTP ${res.status}).`);
      }
      return parseJson<{ value: string; expiresAt: number | null; realtimeUrl: string }>(res);
    },

    /** Envía una llamada Realtime al puente de herramientas autenticado de Runtime. */
    executeTool: async (conversationId: string, name: string, callId: string, args: string): Promise<unknown> => {
      const res = await fetch(`${apiBaseUrl(config)}/v1/conversations/${encodeURIComponent(conversationId)}/voice/tools/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: apiHeaders(config, { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Voice-Call-Id': callId }),
        body: JSON.stringify({ arguments: args }),
      });
      if (!res.ok) {
        const data = await parseJson<{ error?: string; message?: string }>(res);
        throw new ClientError(res.status, data?.error ?? data?.message ?? `No se pudo ejecutar la herramienta (HTTP ${res.status}).`);
      }
      return (await parseJson<{ result: unknown }>(res)).result;
    },
  };
}
