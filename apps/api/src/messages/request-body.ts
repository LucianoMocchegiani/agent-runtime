import { HTTPException } from 'hono/http-exception';

/** Lee JSON con un límite de bytes también aplicado a cuerpos sin Content-Length. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
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
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON' });
  }
}
