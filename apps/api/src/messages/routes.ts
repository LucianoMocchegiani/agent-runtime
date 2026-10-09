import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamAgentTurn } from '../agent/run.js';
import type { AppEnv } from '../auth/principal.js';
import { createMemoryMcpClient } from '../memory/client.js';
import { requireConversationId } from '../conversations/ids.js';
import { getConversation } from '../conversations/service.js';
import { resolveModel, type ResolvedModel } from '../llm/provider.js';

const TEXT_MAX = 100_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 10;
// Hasta diez imágenes de 5 MiB codificadas en base64, más el JSON que las envuelve.
const MAX_BODY_CHARS = 72_000_000;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

type IncomingImage = { data: Uint8Array; mediaType: string };

async function readJsonBody(c: { req: { text: () => Promise<string> } }): Promise<unknown> {
  const text = await c.req.text();
  if (text.length > MAX_BODY_CHARS) {
    throw new HTTPException(413, { message: 'La solicitud supera el tamaño máximo permitido.' });
  }
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON' });
  }
}

function bodyRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HTTPException(400, { message: 'Body must be a JSON object' });
  }
  return body as Record<string, unknown>;
}

function readText(body: unknown): string {
  const raw = bodyRecord(body).text;
  if (raw === undefined) return '';
  if (typeof raw !== 'string') {
    throw new HTTPException(400, { message: 'text must be a string' });
  }
  const trimmed = raw.trim();
  if (trimmed.length > TEXT_MAX) {
    throw new HTTPException(400, { message: `El mensaje no puede superar los ${TEXT_MAX.toLocaleString('es-AR')} caracteres.` });
  }
  return trimmed;
}

function parseImage(raw: unknown): IncomingImage {
  if (typeof raw !== 'string') {
    throw new HTTPException(400, { message: 'Cada imagen debe ser una data URL base64.' });
  }
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(raw);
  if (!match) {
    throw new HTTPException(400, { message: 'Formato de imagen inválido. Usá JPEG, PNG, WebP o GIF.' });
  }
  const mediaType = match[1].toLowerCase();
  const encoded = match[2];
  if (!SUPPORTED_IMAGE_TYPES.has(mediaType) || !encoded || encoded.length % 4 !== 0) {
    throw new HTTPException(400, { message: 'Imagen inválida o vacía.' });
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.toString('base64') !== encoded || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new HTTPException(413, { message: 'La imagen supera el límite de 5 MB o no es válida.' });
  }
  return { data: new Uint8Array(buffer), mediaType };
}

function readImages(body: unknown): IncomingImage[] {
  const record = bodyRecord(body);
  if (record.images !== undefined && record.image !== undefined) {
    throw new HTTPException(400, { message: 'Enviá images o image, no ambos.' });
  }
  if (record.images !== undefined) {
    if (!Array.isArray(record.images)) {
      throw new HTTPException(400, { message: 'images must be an array' });
    }
    if (record.images.length > MAX_IMAGES) {
      throw new HTTPException(400, { message: `Podés adjuntar hasta ${MAX_IMAGES} imágenes por mensaje.` });
    }
    return record.images.map(parseImage);
  }
  if (record.image === undefined || record.image === null) return [];
  return [parseImage(record.image)];
}

/** `model` opcional (`proveedor/modelo`); sin él, el default de `AI_CONFIG`. */
function readModel(body: unknown): ResolvedModel {
  const raw = (body as { model?: unknown }).model;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    throw new HTTPException(400, { message: 'model must be a string' });
  }
  const resolved = resolveModel(raw);
  if (!resolved) {
    throw new HTTPException(400, { message: `Unknown model: ${raw}. See GET /v1/models` });
  }
  return resolved;
}

/**
 * Mensajes de un hilo. GET lista; POST stremea un turno (UI Message Stream).
 */
export const messageRoutes = new Hono<AppEnv>();

messageRoutes.get('/', async (c) => {
  const id = requireConversationId(c.req.param('id'));
  await getConversation(c.get('principal'), id);
  const principal = c.get('principal');
  const memory = await createMemoryMcpClient();
  try {
    const rows = await memory.listMessages({
      conversationId: id,
      userId: principal.userId,
    });
    return c.json({ items: rows });
  } finally {
    await memory.close().catch(() => undefined);
  }
});

messageRoutes.post('/', async (c) => {
  const id = requireConversationId(c.req.param('id'));
  const conversation = await getConversation(c.get('principal'), id);
  if (conversation.archivedAt) {
    throw new HTTPException(409, { message: 'Conversation archived' });
  }
  const body = await readJsonBody(c);
  const text = readText(body);
  const images = readImages(body);
  if (!text && images.length === 0) {
    throw new HTTPException(400, { message: 'Escribí un mensaje o adjuntá una imagen.' });
  }
  // Solo guardamos el texto y una nota; los bytes de las imágenes viven durante este turno.
  const imageNote = images.length === 1
    ? '[Imagen adjunta; no almacenada]'
    : `[${images.length} imágenes adjuntas; no almacenadas]`;
  const messageText = images.length
    ? `${text}${text ? '\n\n' : ''}${imageNote}`
    : text;
  const model = readModel(body);
  const principal = c.get('principal');
  return streamAgentTurn(
    id,
    principal,
    c.get('accessToken'),
    messageText,
    model,
    c.req.raw.signal,
    c.get('mcpAuth') ?? undefined,
    images,
  );
});