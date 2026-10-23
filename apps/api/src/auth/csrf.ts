import { config } from '../config.js';

/**
 * Comprueba el origen de peticiones que dependen de credenciales enviadas automáticamente por el navegador.
 * Solo admite el mismo origen o un origen explícitamente configurado; los comodines CORS por dominio/tenant
 * no se consideran confianza suficiente para acceder a datos de sesión.
 */
export function isTrustedBrowserRequest(request: Request): boolean {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.origin === origin && parsedOrigin.origin === requestUrl.origin) return true;
      return parsedOrigin.origin === origin && config.corsOrigins.includes(origin);
    } catch {
      return false;
    }
  }

  // Fetch Metadata sirve para peticiones same-origin, donde algunos navegadores omiten Origin.
  if (request.headers.get('Sec-Fetch-Site')?.toLowerCase() === 'same-origin') return true;
  const referer = request.headers.get('Referer');
  if (referer) {
    try { return new URL(referer).origin === requestUrl.origin; } catch { return false; }
  }
  return false;
}
