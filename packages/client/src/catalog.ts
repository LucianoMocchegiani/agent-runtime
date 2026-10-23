import { ClientError } from './client-error.js';
import { apiFetch, apiBaseUrl, apiHeaders, parseJson } from './http.js';
import type { AgentProfileInfo, ClientConfig, ModelList } from './types.js';

/** Construye las consultas del catálogo de modelos y perfiles disponibles. */
export function createCatalogApi(config: ClientConfig) {
  return {
    /** Obtiene el catálogo de modelos y el predeterminado. @throws {ClientError} Si falla la solicitud. */
    models: {
      list: async (): Promise<ModelList> => {
        const res = await apiFetch(config, `${apiBaseUrl(config)}/v1/models`, {
          headers: apiHeaders(config, { Accept: 'application/json' }),
        });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        const data = await parseJson<ModelList>(res);
        return { default: data?.default ?? '', items: data?.items ?? [] };
      },
    },

    /**
     * Lista los metadatos de perfiles disponibles.
     * @throws {ClientError} Si falla la solicitud.
     */
    agentProfiles: {
      list: async (): Promise<AgentProfileInfo[]> => {
        const res = await apiFetch(config, `${apiBaseUrl(config)}/v1/agent-profiles`, {
          headers: apiHeaders(config, { Accept: 'application/json' }),
        });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        const data = await parseJson<{ items: AgentProfileInfo[] }>(res);
        return data?.items ?? [];
      },
    },
  };
}
