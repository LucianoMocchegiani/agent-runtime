import { HTTPException } from 'hono/http-exception';

const DEFAULT_MAX_BYTES = 1_000_000;

export type ReadJsonBodyOptions = {
  /** Si es `false`, rechaza un cuerpo vacío en lugar de interpretarlo como objeto vacío. */
  allowEmpty?: boolean;
};

/**
 * Lee y parsea JSON aplicando el límite de bytes incluso si falta `Content-Length`.
 * @param request Solicitud HTTP cuyo cuerpo se consume.
 * @param maxBytes Máximo permitido en bytes.
 * @param options Política para cuerpos vacíos.
 * @throws {HTTPException} 400 si el JSON no es válido o 413 si se supera el límite.
 */
export async function readJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_BYTES,
  { allowEmpty = true }: ReadJsonBodyOptions = {},
): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new HTTPException(413, { message: 'La solicitud supera el tamaño máximo permitido.' });
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new HTTPException(413, { message: 'La solicitud supera el tamaño máximo permitido.' });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  if (totalBytes === 0) {
    if (!allowEmpty) throw new HTTPException(400, { message: 'Body must be a JSON object' });
    return {};
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON' });
  }
  if (!text.trim()) {
    if (!allowEmpty) throw new HTTPException(400, { message: 'Body must be a JSON object' });
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON' });
  }
}
