import { ClientError } from './client-error.js';
import { apiFetch, apiBaseUrl, apiHeaders, parseJson } from './http.js';
import type { ClientConfig } from './types.js';

export type McpOAuthConnection = {
  name: string;
  connected: boolean;
  account: string | null;
  expiresAt: string | null;
};

type ConnectionList = { items: McpOAuthConnection[] };

/** Operaciones tipadas para administrar conexiones OAuth de los MCP configurados en Runtime. */
export function createMcpConnectionsApi(config: ClientConfig) {
  const url = `${apiBaseUrl(config)}/v1/mcp-connections`;
  return {
    /** Devuelve solo estado/metadatos no secretos de los MCP que tengan OAuth configurado. */
    list: async (): Promise<McpOAuthConnection[]> => {
      const res = await apiFetch(config, url, { headers: apiHeaders(config, { Accept: 'application/json' }) });
      if (!res.ok) throw new ClientError(res.status, `No se pudieron cargar las conexiones MCP (HTTP ${res.status}).`);
      const data = await parseJson<ConnectionList>(res);
      return data?.items ?? [];
    },

    authorize: async (name: string): Promise<string> => {
      const res = await apiFetch(config, `${url}/${encodeURIComponent(name)}/authorize`, {
        method: 'POST', headers: apiHeaders(config, { Accept: 'application/json' }),
      });
      if (!res.ok) throw new ClientError(res.status, `No se pudo iniciar OAuth para ${name} (HTTP ${res.status}).`);
      const data = await parseJson<{ authorizationUrl: string }>(res);
      if (!data?.authorizationUrl) throw new ClientError(500, 'Runtime no devolvió la URL de autorización.');
      return data.authorizationUrl;
    },

    disconnect: async (name: string): Promise<void> => {
      const res = await apiFetch(config, `${url}/${encodeURIComponent(name)}`, { method: 'DELETE', headers: apiHeaders(config) });
      if (!res.ok) throw new ClientError(res.status, `No se pudo desconectar ${name} (HTTP ${res.status}).`);
    },
  };
}
