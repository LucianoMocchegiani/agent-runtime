import { ClientError } from './client-error.js';
import { apiBaseUrl, apiHeaders, parseJson } from './http.js';
import type { ClientConfig, Conversation, CursorPage, CursorPageOptions } from './types.js';

function cursorQuery(options: CursorPageOptions & { archived?: boolean } = {}): string {
  const query = new URLSearchParams();
  if (options.archived) query.set('archived', 'true');
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  return query.size ? `?${query.toString()}` : '';
}

async function fetchConversationPage(
  config: ClientConfig,
  options: { archived?: boolean } & CursorPageOptions = {},
): Promise<CursorPage<Conversation>> {
  const suffix = cursorQuery(options);
  const res = await fetch(`${apiBaseUrl(config)}/v1/conversations${suffix}`, {
    headers: apiHeaders(config, { Accept: 'application/json' }),
  });
  if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
  const data = await parseJson<CursorPage<Conversation>>(res);
  return { items: data?.items ?? [], hasMore: data?.hasMore ?? false, nextCursor: data?.nextCursor ?? null };
}

/** Construye las operaciones HTTP de conversaciones. */
export function createConversationsApi(config: ClientConfig) {
  return {
    /**
     * Recorre páginas hasta acumular 100 conversaciones o agotar los resultados.
     * @param options Filtro opcional para listar conversaciones archivadas.
     * @returns Conversaciones en el orden que devuelve la API, limitadas a 100.
     * @throws {ClientError} Si una solicitud HTTP falla.
     */
    list: async (options: { archived?: boolean } = {}): Promise<Conversation[]> => {
      const items: Conversation[] = [];
      let cursor: string | undefined;
      do {
        const page = await fetchConversationPage(config, { ...options, limit: 20, ...(cursor ? { cursor } : {}) });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        if (!page.hasMore || items.length >= 100) break;
      } while (cursor);
      return items.slice(0, 100);
    },

    /** Solicita una página sin recorrer las siguientes. @throws {ClientError} Si falla la solicitud. */
    listPage: async (options: { archived?: boolean } & CursorPageOptions = {}): Promise<CursorPage<Conversation>> =>
      fetchConversationPage(config, options),

    /** Crea una conversación, opcionalmente asignándole un perfil inicial. @throws {ClientError} Si falla la solicitud. */
    create: async (options: { agentProfileId?: string } = {}): Promise<Conversation> => {
      const res = await fetch(`${apiBaseUrl(config)}/v1/conversations`, {
        method: 'POST',
        headers: apiHeaders(config, { 'Content-Type': 'application/json', Accept: 'application/json' }),
        body: JSON.stringify(options),
      });
      if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
      return parseJson<Conversation>(res);
    },

    /** Obtiene una conversación por identificador. @throws {ClientError} Si falla la solicitud. */
    get: async (id: string): Promise<Conversation> => {
      const res = await fetch(`${apiBaseUrl(config)}/v1/conversations/${id}`, {
        headers: apiHeaders(config, { Accept: 'application/json' }),
      });
      if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
      return parseJson<Conversation>(res);
    },

    /** Archiva una conversación. @throws {ClientError} Si falla la solicitud. */
    archive: async (id: string): Promise<Conversation> => {
      const res = await fetch(`${apiBaseUrl(config)}/v1/conversations/${id}`, {
        method: 'DELETE',
        headers: apiHeaders(config),
      });
      if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
      return parseJson<Conversation>(res);
    },

    /**
     * Actualiza solo los campos presentes en el objeto `patch`.
     * @throws {ClientError} Si falla la solicitud.
     */
    patch: async (
      id: string,
      patch: { title?: string | null; archived?: boolean; agentProfileId?: string | null },
    ): Promise<Conversation> => {
      const res = await fetch(`${apiBaseUrl(config)}/v1/conversations/${id}`, {
        method: 'PATCH',
        headers: apiHeaders(config, { 'Content-Type': 'application/json', Accept: 'application/json' }),
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
      return parseJson<Conversation>(res);
    },
  };
}
