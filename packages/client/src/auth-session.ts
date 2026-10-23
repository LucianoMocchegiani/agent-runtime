import { ClientError } from './client-error.js';
import { apiFetch, apiBaseUrl, parseJson } from './http.js';
import type { ClientConfig } from './types.js';

/** Estado público de la sesión autenticada del navegador. */
export type AuthSession = { authenticated: boolean };

type SessionResponse = AuthSession & { error?: string; message?: string };

async function requestSession(config: ClientConfig, method: 'GET' | 'POST' | 'DELETE', token?: string): Promise<AuthSession> {
  const res = await apiFetch(config, `${apiBaseUrl(config)}/auth/session`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(token ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(token ? { body: JSON.stringify({ token }) } : {}),
  });
  const data = await parseJson<SessionResponse>(res);
  if (!res.ok) {
    throw new ClientError(res.status, data?.error || data?.message || `No se pudo actualizar la sesión (HTTP ${res.status}).`);
  }
  return { authenticated: Boolean(data?.authenticated) };
}

/** Construye las operaciones de sesión del navegador, basadas en cookie HttpOnly. */
export function createAuthSessionApi(config: ClientConfig) {
  return {
    /** Consulta si existe una sesión válida en la cookie HttpOnly. */
    get: (): Promise<AuthSession> => requestSession(config, 'GET'),
    /** Valida y guarda un Bearer en la cookie HttpOnly. */
    set: (token: string): Promise<AuthSession> => requestSession(config, 'POST', token),
    /** Elimina la cookie de sesión. */
    clear: (): Promise<AuthSession> => requestSession(config, 'DELETE'),
  };
}
