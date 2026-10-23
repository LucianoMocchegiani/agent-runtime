import { ClientError } from './client-error.js';
import { apiFetch, apiBaseUrl, parseJson } from './http.js';
import type { ClientConfig } from './types.js';

export type AdminRuntimeConfig = {
  version: number;
  settings: Record<string, unknown>;
};

export type AdminAgentProfile = {
  id: string;
  name: string;
  model: Record<string, unknown>;
  config: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminProfileList = {
  items: AdminAgentProfile[];
  defaultForNewChatsId: string | null;
};

export type RuntimeAdmin = {
  userId: string;
  createdAt: string;
  createdByUserId: string | null;
};

export type RuntimeAdminList = { items: RuntimeAdmin[] };

async function adminRequest<T>(
  config: ClientConfig,
  authorization: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', authorization);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await apiFetch(config, `${apiBaseUrl(config)}${path}`, { ...init, headers });
  if (!res.ok) {
    const data = await parseJson<{ error?: string; message?: string }>(res).catch(() => null);
    throw new ClientError(res.status, data?.error ?? data?.message ?? `HTTP ${res.status}`);
  }
  return parseJson<T>(res);
}

/** Operaciones administrativas. Cada llamada recibe su autorización sin usar las credenciales normales del cliente. */
export function createAdminApi(config: ClientConfig) {
  return {
    /** Lee la configuración del runtime, con secretos enmascarados. */
    getRuntimeConfig: (authorization: string): Promise<AdminRuntimeConfig> =>
      adminRequest(config, authorization, '/admin/runtime-config'),

    /** Guarda una configuración versionada del runtime. */
    saveRuntimeConfig: (
      authorization: string,
      input: { version: number; settings: Record<string, unknown> },
    ): Promise<AdminRuntimeConfig> => adminRequest(config, authorization, '/admin/runtime-config', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

    /** Prueba la introspección de identidad con la configuración y el token indicados. */
    testAuth: (
      authorization: string,
      input: { settings: Record<string, unknown>; token: string },
    ): Promise<{ identity: { userId: string; email?: string; name?: string } }> =>
      adminRequest(config, authorization, '/admin/runtime-config/test-auth', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    /** Lista perfiles administrativos activos y el predeterminado para chats nuevos. */
    listAgentProfiles: (authorization: string): Promise<AdminProfileList> =>
      adminRequest(config, authorization, '/admin/agent-profiles'),

    /** Lista las identidades autorizadas a administrar el runtime. */
    listRuntimeAdmins: (authorization: string): Promise<RuntimeAdminList> =>
      adminRequest(config, authorization, '/admin/runtime-admins'),

    /** Autoriza una identidad verificada para administrar el runtime. */
    addRuntimeAdmin: (authorization: string, userId: string): Promise<{ item: RuntimeAdmin }> =>
      adminRequest(config, authorization, '/admin/runtime-admins', {
        method: 'POST', body: JSON.stringify({ userId }),
      }),

    /** Revoca el acceso administrativo de una identidad. */
    removeRuntimeAdmin: (authorization: string, userId: string): Promise<{ ok: true }> =>
      adminRequest(config, authorization, `/admin/runtime-admins/${encodeURIComponent(userId)}`, { method: 'DELETE' }),

    /** Cambia el perfil predeterminado para conversaciones nuevas. */
    setDefaultForNewChats: (
      authorization: string,
      profileId: string,
    ): Promise<{ defaultForNewChatsId: string }> => adminRequest(
      config,
      authorization,
      '/admin/agent-profiles/default-for-new-chats',
      { method: 'PUT', body: JSON.stringify({ profileId }) },
    ),

    /** Crea un perfil de agente. */
    createAgentProfile: (
      authorization: string,
      profile: Omit<AdminAgentProfile, 'id' | 'createdAt' | 'updatedAt'>,
    ): Promise<AdminAgentProfile> => adminRequest(config, authorization, '/admin/agent-profiles', {
      method: 'POST',
      body: JSON.stringify(profile),
    }),

    /** Actualiza un perfil de agente existente. */
    updateAgentProfile: (
      authorization: string,
      id: string,
      profile: Omit<AdminAgentProfile, 'id' | 'createdAt' | 'updatedAt'>,
    ): Promise<AdminAgentProfile> => adminRequest(
      config,
      authorization,
      `/admin/agent-profiles/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(profile) },
    ),

    /** Archiva un perfil de agente. */
    archiveAgentProfile: (authorization: string, id: string): Promise<{ ok: true }> =>
      adminRequest(config, authorization, `/admin/agent-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}
