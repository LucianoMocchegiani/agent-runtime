import { ClientError } from './client-error.js';
import { apiFetch, apiBaseUrl, apiHeaders, parseJson } from './http.js';
import type { ClientConfig, CursorPage, CursorPageOptions, SavePreferenceOptions, UserPreference } from './types.js';

function cursorQuery(options: CursorPageOptions = {}): string {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  return query.size ? `?${query.toString()}` : '';
}

async function fetchPreferencePage(config: ClientConfig, options: CursorPageOptions = {}): Promise<CursorPage<UserPreference>> {
  const suffix = cursorQuery(options);
  const res = await apiFetch(config, `${apiBaseUrl(config)}/v1/preferences${suffix}`, {
    headers: apiHeaders(config, { Accept: 'application/json' }),
  });
  if (!res.ok) throw new ClientError(res.status, `No se pudieron cargar las preferencias (HTTP ${res.status}).`);
  const data = await parseJson<CursorPage<UserPreference>>(res);
  return { items: data?.items ?? [], hasMore: data?.hasMore ?? false, nextCursor: data?.nextCursor ?? null };
}

/** Construye las operaciones HTTP de preferencias persistentes. */
export function createPreferencesApi(config: ClientConfig) {
  return {
    /**
     * Recorre páginas hasta acumular 100 preferencias o agotar los resultados.
     * @returns Preferencias en el orden que devuelve la API, limitadas a 100.
     * @throws {ClientError} Si una solicitud HTTP falla.
     */
    list: async (): Promise<UserPreference[]> => {
      const items: UserPreference[] = [];
      let cursor: string | undefined;
      do {
        const page = await fetchPreferencePage(config, { limit: 20, ...(cursor ? { cursor } : {}) });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        if (!page.hasMore || items.length >= 100) break;
      } while (cursor);
      return items.slice(0, 100);
    },

    /** Solicita una página sin recorrer las siguientes. @throws {ClientError} Si falla la solicitud. */
    listPage: async (options: CursorPageOptions = {}): Promise<CursorPage<UserPreference>> =>
      fetchPreferencePage(config, options),

    /** Guarda una preferencia persistente. @throws {ClientError} Si falla la solicitud. */
    save: async (preference: SavePreferenceOptions): Promise<UserPreference> => {
      const res = await apiFetch(config, `${apiBaseUrl(config)}/v1/preferences`, {
        method: 'POST',
        headers: apiHeaders(config, { 'Content-Type': 'application/json', Accept: 'application/json' }),
        body: JSON.stringify(preference),
      });
      if (!res.ok) throw new ClientError(res.status, `No se pudo guardar la preferencia (HTTP ${res.status}).`);
      return parseJson<UserPreference>(res);
    },

    /**
     * Elimina una preferencia por identificador.
     * @throws {ClientError} Si falla la solicitud.
     */
    delete: async (id: string): Promise<void> => {
      const res = await apiFetch(config, `${apiBaseUrl(config)}/v1/preferences/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: apiHeaders(config),
      });
      if (!res.ok) throw new ClientError(res.status, `No se pudo borrar la preferencia (HTTP ${res.status}).`);
    },
  };
}
