import { ClientError } from './client-error.js';
import { apiFetch, apiBaseUrl, apiHeaders, parseJson } from './http.js';
import type { ClientConfig, Delegation, DelegationEvent } from './types.js';

/** Construye las consultas y el stream SSE de delegaciones. */
export function createDelegationsApi(config: ClientConfig) {
  return {
    /**
     * Lista las delegaciones del usuario autenticado.
     * @throws {ClientError} Si falla la solicitud.
     */
    list: async (): Promise<Delegation[]> => {
      const res = await apiFetch(config, `${apiBaseUrl(config)}/v1/delegations`, {
        headers: apiHeaders(config, { Accept: 'application/json' }),
      });
      if (!res.ok) throw new ClientError(res.status, `No se pudieron listar las delegaciones (HTTP ${res.status}).`);
      const data = await parseJson<{ items: Delegation[] }>(res);
      return data?.items ?? [];
    },

    /** Consulta una delegación propia por identificador. @throws {ClientError} Si falla la solicitud. */
    get: async (id: string): Promise<Delegation> => {
      const res = await apiFetch(config, `${apiBaseUrl(config)}/v1/delegations/${encodeURIComponent(id)}`, {
        headers: apiHeaders(config, { Accept: 'application/json' }),
      });
      if (!res.ok) throw new ClientError(res.status, `No se pudo consultar la delegación (HTTP ${res.status}).`);
      return parseJson<Delegation>(res);
    },

    /**
     * Sigue los eventos SSE desde el cursor opcional hasta que cierre el servidor o se cancele la señal.
     * Los eventos con datos inválidos se ignoran; `createdAt` representa el momento local de recepción.
     * @param id Identificador de la delegación.
     * @param options Cursor inicial, señal de cancelación y callback obligatorio para los eventos.
     * @returns Se resuelve cuando termina el stream.
     * @throws {ClientError} Si la respuesta HTTP no es exitosa o no incluye un stream.
     */
    events: async (
      id: string,
      options: { after?: string; signal?: AbortSignal; onEvent: (event: DelegationEvent) => void },
    ): Promise<void> => {
      const query = options.after ? `?after=${encodeURIComponent(options.after)}` : '';
      const res = await apiFetch(config, `${apiBaseUrl(config)}/v1/delegations/${encodeURIComponent(id)}/events${query}`, {
        headers: apiHeaders(config, { Accept: 'text/event-stream' }),
        signal: options.signal,
      });
      if (!res.ok) throw new ClientError(res.status, `No se pudieron cargar los eventos (HTTP ${res.status}).`);
      if (!res.body) throw new ClientError(502, 'El stream de eventos no está disponible.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastId = options.after ?? '';
      const dispatch = (block: string) => {
        let idValue = lastId;
        let eventType = 'message';
        const data: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('id:')) idValue = line.slice(3).trim();
          else if (line.startsWith('event:')) eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (!data.length) return;
        lastId = idValue;
        try {
          options.onEvent({ id: idValue, type: eventType, data: JSON.parse(data.join('\n')), createdAt: new Date().toISOString() });
        } catch {
          // Ignoramos eventos malformados; el estado se puede volver a consultar.
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() ?? '';
          for (const block of blocks) dispatch(block);
        }
        if (buffer.trim()) dispatch(buffer);
      } finally {
        reader.releaseLock();
      }
    },
  };
}
