import { ClientError } from './client-error.js';
import { isAbortError } from './abort.js';
import { apiFetch, apiBaseUrl, apiHeaders, parseJson } from './http.js';
import { consumeUiMessageStream } from './stream.js';
import type { ClientConfig, MessageListOptions, MessagePage, SendOptions, StreamHandlers } from './types.js';

async function streamTurn(
  config: ClientConfig,
  path: string,
  body: Record<string, unknown>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<'ok' | 'aborted'> {
  try {
    const res = await apiFetch(config, `${apiBaseUrl(config)}${path}`, {
      method: 'POST',
      headers: apiHeaders(config, { 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const parsed = await parseJson<unknown>(res);
      const message = typeof parsed === 'object' && parsed !== null
        ? (parsed as { error?: string; message?: string }).error
          ?? (parsed as { error?: string; message?: string }).message
          ?? `Error HTTP ${res.status}`
        : `Error HTTP ${res.status}`;
      throw new ClientError(res.status, message);
    }
    if (!res.body) throw new ClientError(502, 'El asistente no está disponible.');

    await consumeUiMessageStream(res.body, handlers);
    if (signal?.aborted) return 'aborted';
    handlers.onFinish?.();
    return 'ok';
  } catch (error) {
    if (isAbortError(error)) return 'aborted';
    throw error;
  }
}

/** Construye las operaciones de historial y turnos de mensajes. */
export function createMessagesApi(config: ClientConfig) {
  return {
    /**
     * Obtiene una página de mensajes, opcionalmente anterior a un cursor.
     * @param conversationId Identificador de la conversación.
     * @param options Límite y cursor compuesto por fecha e identificador.
     * @returns Página en orden definido por la API, con cursor para continuar.
     * @throws {ClientError} Si falla la solicitud HTTP.
     */
    list: async (conversationId: string, options: MessageListOptions = {}): Promise<MessagePage> => {
      const query = new URLSearchParams();
      if (options.limit !== undefined) query.set('limit', String(options.limit));
      if (options.before) {
        query.set('beforeCreatedAt', options.before.createdAt);
        query.set('beforeId', options.before.id);
      }
      const suffix = query.size ? `?${query.toString()}` : '';
      const res = await apiFetch(config, 
        `${apiBaseUrl(config)}/v1/conversations/${conversationId}/messages${suffix}`,
        { headers: apiHeaders(config, { Accept: 'application/json' }) },
      );
      if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
      const data = await parseJson<MessagePage>(res);
      return data ?? { items: [], hasMore: false, nextCursor: null };
    },

    /**
     * Envía un turno y despacha deltas y eventos a los handlers.
     * @param conversationId Conversación a la que se agrega el turno.
     * @param text Texto del mensaje del usuario.
     * @param handlers Callbacks opcionales para los eventos del stream.
     * @param signal Señal opcional para cancelar la solicitud.
     * @param options Imágenes adjuntas al mensaje; `images` tiene prioridad sobre `image`.
     * @returns `ok` al finalizar o `aborted` si se cancela la solicitud.
     * @throws {ClientError} Si falla la respuesta HTTP o no se puede consumir el stream.
     */
    send: async (
      conversationId: string,
      text: string,
      handlers: StreamHandlers = {},
      signal?: AbortSignal,
      options: SendOptions = {},
    ): Promise<'ok' | 'aborted'> => streamTurn(
      config,
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        text,
        ...(options.images?.length ? { images: options.images } : {}),
        ...(!options.images?.length && options.image ? { image: options.image } : {}),
      },
      handlers,
      signal,
    ),

    /**
     * Edita un mensaje del usuario y regenera el turno desde ese punto.
     * @param conversationId Conversación propietaria del mensaje.
     * @param messageId Identificador del mensaje que se editará.
     * @param text Nuevo contenido del mensaje.
     * @param expectedLaterMessages Cantidad de mensajes posteriores esperada por el servidor, para validar concurrencia.
     * @param handlers Callbacks opcionales para los eventos del stream.
     * @param signal Señal opcional para cancelar la solicitud.
     * @returns `ok` al finalizar o `aborted` si se cancela la solicitud.
     * @throws {ClientError} Si falla la respuesta HTTP o no se puede consumir el stream.
     */
    edit: async (
      conversationId: string,
      messageId: string,
      text: string,
      expectedLaterMessages: number,
      handlers: StreamHandlers = {},
      signal?: AbortSignal,
    ): Promise<'ok' | 'aborted'> => streamTurn(
      config,
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/edit`,
      { text, expectedLaterMessages },
      handlers,
      signal,
    ),
  };
}
