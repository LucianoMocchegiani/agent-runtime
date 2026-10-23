import type { ClientConfig } from './types.js';
import { ClientError } from './client-error.js';

/** Quita una barra final para evitar duplicarla al construir las rutas. */
export function apiFetch(config: ClientConfig, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, credentials: init.credentials ?? 'include' });
}

export function apiBaseUrl(config: ClientConfig): string {
  return config.baseUrl.replace(/\/$/, '');
}

/** Construye los encabezados comunes y consulta las credenciales por solicitud. */
export function apiHeaders(config: ClientConfig, extra: Record<string, string> = {}): Record<string, string> {
  const token = config.getBearer?.();
  const auth = config.getMcpAuth?.();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(auth ? { 'X-MCP-Auth': JSON.stringify(auth) } : {}),
    ...extra,
  };
}

/** Lee JSON de una respuesta; los cuerpos vacíos se representan como `null`. */
export async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ClientError(res.status, text);
  }
}
