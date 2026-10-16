import { Hono } from 'hono';
import {
  MESSAGE_BODY_MAX_BYTES,
  MESSAGE_EDIT_BODY_MAX_BYTES,
  MESSAGE_EDIT_MAX_LATER_MESSAGES,
  MESSAGE_IMAGE_MAX_BYTES,
  MESSAGE_LIST_DEFAULT_LIMIT,
  MESSAGE_LIST_MAX_LIMIT,
  MESSAGE_MAX_IMAGES,
  MESSAGE_TEXT_MAX_LENGTH,
  SUPPORTED_MESSAGE_IMAGE_TYPES,
  UNSAVED_IMAGE_NOTE,
  UNSAVED_IMAGES_NOTE_SUFFIX,
} from './constants.js';
import { HTTPException } from 'hono/http-exception';
import { streamAgentTurn } from '../agent/turn/run.js';
import type { AppEnv } from '../auth/contracts.js';
import { listMessages, editMessageAndTruncate } from './persistence.js';
import { requireConversationId } from '../conversations/ids.js';
import { getConversation } from '../conversations/service.js';
import { resolveModel } from '../llm/provider.js';
import { acquireConversationTurn } from '../agent/turn/lock.js';
import { getAgentProfile } from '../runtime-config/agent-profiles.js';
import { readJsonBody } from '../http/request-body.js';
import {
  MessageContainsUnstoredAttachmentError,
  MessageEditConflictError,
  MessageNotEditableError,
} from './errors.js';

type IncomingImage = { data: Uint8Array; mediaType: string };

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
  if (trimmed.length > MESSAGE_TEXT_MAX_LENGTH) {
    throw new HTTPException(400, { message: `El mensaje no puede superar los ${MESSAGE_TEXT_MAX_LENGTH.toLocaleString('es-AR')} caracteres.` });
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
  if (!SUPPORTED_MESSAGE_IMAGE_TYPES.has(mediaType) || !encoded || encoded.length % 4 !== 0) {
    throw new HTTPException(400, { message: 'Imagen inválida o vacía.' });
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.toString('base64') !== encoded || buffer.byteLength > MESSAGE_IMAGE_MAX_BYTES) {
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
    if (record.images.length > MESSAGE_MAX_IMAGES) {
      throw new HTTPException(400, { message: `Podés adjuntar hasta ${MESSAGE_MAX_IMAGES} imágenes por mensaje.` });
    }
    return record.images.map(parseImage);
  }
  if (record.image === undefined || record.image === null) return [];
  return [parseImage(record.image)];
}

async function releaseTurnWhenResponseEnds(response: Response, release: () => Promise<void>): Promise<Response> {
  if (!response.body) {
    await release();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await release();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        await release().catch((releaseError: unknown) => console.error('No se pudo liberar la reserva del turno.', releaseError));
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await release();
      }
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Rutas de mensajes: listado paginado, envío con stream y edición con regeneración.
 * Los turnos se coordinan con un lease compartido y los adjuntos no se persisten.
 */
export const messageRoutes = new Hono<AppEnv>();

messageRoutes.get('/', async (c) => {
  const id = requireConversationId(c.req.param('id'));
  await getConversation(c.get('principal'), id);
  const principal = c.get('principal');
  const query = c.req.query();
  const rawLimit = query.limit;
  const limit = rawLimit === undefined ? MESSAGE_LIST_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MESSAGE_LIST_MAX_LIMIT) {
    throw new HTTPException(400, { message: `limit debe ser un entero entre 1 y ${MESSAGE_LIST_MAX_LIMIT}.` });
  }

  const beforeCreatedAt = query.beforeCreatedAt;
  const beforeId = query.beforeId;
  if ((beforeCreatedAt === undefined) !== (beforeId === undefined)) {
    throw new HTTPException(400, { message: 'beforeCreatedAt y beforeId deben enviarse juntos.' });
  }
  let before: { createdAt: string; id: string } | undefined;
  if (beforeCreatedAt !== undefined && beforeId !== undefined) {
    if (!Number.isFinite(Date.parse(beforeCreatedAt)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(beforeId)) {
      throw new HTTPException(400, { message: 'Cursor de mensajes inválido.' });
    }
    before = { createdAt: beforeCreatedAt, id: beforeId };
  }

  const page = await listMessages({
    conversationId: id,
    userId: principal.userId,
    limit,
    before,
  });
  return c.json(page);
});

messageRoutes.post('/:messageId/edit', async (c) => {
  const id = requireConversationId(c.req.param('id'));
  const messageId = c.req.param('messageId');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
    throw new HTTPException(400, { message: 'Identificador de mensaje inválido.' });
  }
  const conversation = await getConversation(c.get('principal'), id);
  if (conversation.archivedAt) throw new HTTPException(409, { message: 'Conversation archived' });

  const body = bodyRecord(await readJsonBody(c.req.raw, MESSAGE_EDIT_BODY_MAX_BYTES));
  const text = readText(body);
  if (!text) throw new HTTPException(400, { message: 'El mensaje editado no puede estar vacío.' });
  const expectedLaterMessages = body.expectedLaterMessages;
  if (typeof expectedLaterMessages !== 'number' || !Number.isInteger(expectedLaterMessages)
    || expectedLaterMessages < 0 || expectedLaterMessages > MESSAGE_EDIT_MAX_LATER_MESSAGES) {
    throw new HTTPException(400, { message: `expectedLaterMessages debe ser un entero entre 0 y ${MESSAGE_EDIT_MAX_LATER_MESSAGES}.` });
  }
  if (body.images !== undefined || body.image !== undefined) {
    throw new HTTPException(400, { message: 'Los adjuntos no se pueden volver a enviar al editar un mensaje.' });
  }
  if (!conversation.agentProfileId) {
    throw new HTTPException(409, { message: 'Esta conversación no tiene un perfil asignado. Asignale un perfil antes de continuar.' });
  }
  const profile = await getAgentProfile(conversation.agentProfileId, true);
  if (!profile) throw new HTTPException(409, { message: 'El perfil asignado a esta conversación ya no está disponible.' });
  const model = resolveModel(profile.modelId, profile.config.contextTokenBudget);
  if (!model) throw new HTTPException(503, { message: profile.modelId ? 'El modelo del perfil no está habilitado.' : 'Configurá un modelo en el primer perfil activo para habilitar el chat.' });

  const principal = c.get('principal');
  let turnLease;
  try {
    turnLease = await acquireConversationTurn(principal.userId, id);
  } catch (error) {
    console.error('No se pudo adquirir la reserva compartida del turno.', error);
    throw new HTTPException(503, { message: 'No se pudo coordinar el turno. Intentá de nuevo en unos instantes.' });
  }
  if (!turnLease) {
    throw new HTTPException(409, { message: 'Ya hay un turno en curso en esta conversación. Esperá a que termine antes de editar.' });
  }

  try {
    try {
      await editMessageAndTruncate({
        conversationId: id,
        messageId,
        userId: principal.userId,
        content: text,
        expectedLaterMessages,
      });
    } catch (error) {
      if (error instanceof MessageEditConflictError) {
        throw new HTTPException(409, { message: 'La conversación cambió desde que confirmaste la edición. Actualizá los mensajes y volvé a intentarlo.' });
      }
      if (error instanceof MessageContainsUnstoredAttachmentError) {
        throw new HTTPException(409, { message: 'Este mensaje tenía imágenes que no se guardaron y no se pueden reenviar.' });
      }
      if (error instanceof MessageNotEditableError) {
        throw new HTTPException(404, { message: 'No se encontró un mensaje propio que se pueda editar.' });
      }
      throw error;
    }

    const response = await streamAgentTurn(
      id,
      principal,
      c.get('accessToken'),
      text,
      model,
      AbortSignal.any([c.req.raw.signal, turnLease.signal]),
      c.get('mcpAuth') ?? undefined,
      [],
      profile,
      { userMessageAlreadySaved: true },
    );
    return await releaseTurnWhenResponseEnds(response, turnLease.release);
  } catch (error) {
    await turnLease.release().catch((releaseError: unknown) => console.error('No se pudo liberar la reserva del turno.', releaseError));
    throw error;
  }
});

messageRoutes.post('/', async (c) => {
  const id = requireConversationId(c.req.param('id'));
  const conversation = await getConversation(c.get('principal'), id);
  if (conversation.archivedAt) {
    throw new HTTPException(409, { message: 'Conversation archived' });
  }
  const body = await readJsonBody(c.req.raw, MESSAGE_BODY_MAX_BYTES);
  const text = readText(body);
  const images = readImages(body);
  if (!text && images.length === 0) {
    throw new HTTPException(400, { message: 'Escribí un mensaje o adjuntá una imagen.' });
  }
  // Solo guardamos el texto y una nota; los bytes de las imágenes viven durante este turno.
  const imageNote = images.length === 1
    ? UNSAVED_IMAGE_NOTE
    : `[${images.length} ${UNSAVED_IMAGES_NOTE_SUFFIX}`;
  const messageText = images.length
    ? `${text}${text ? '\n\n' : ''}${imageNote}`
    : text;
  if (typeof body === 'object' && body !== null && 'model' in body) {
    throw new HTTPException(400, { message: 'El modelo se define en el perfil asignado a la conversación.' });
  }
  // La asignación se fija al crear el hilo o durante el backfill al iniciar Runtime.
  // No recurrir al predeterminado aquí: eso cambiaría silenciosamente el agente del hilo.
  if (!conversation.agentProfileId) {
    throw new HTTPException(409, { message: 'Esta conversación no tiene un perfil asignado. Asignale un perfil antes de continuar.' });
  }
  const profile = await getAgentProfile(conversation.agentProfileId, true);
  if (!profile) throw new HTTPException(409, { message: 'El perfil asignado a esta conversación ya no está disponible.' });
  const model = resolveModel(profile.modelId, profile.config.contextTokenBudget);
  if (!model) throw new HTTPException(503, { message: profile.modelId ? 'El modelo del perfil no está habilitado.' : 'Configurá un modelo en el primer perfil activo para habilitar el chat.' });
  const principal = c.get('principal');
  let turnLease;
  try {
    turnLease = await acquireConversationTurn(principal.userId, id);
  } catch (error) {
    console.error('No se pudo adquirir la reserva compartida del turno.', error);
    throw new HTTPException(503, { message: 'No se pudo coordinar el turno. Intentá de nuevo en unos instantes.' });
  }
  if (!turnLease) {
    throw new HTTPException(409, { message: 'Ya hay un turno en curso en esta conversación. Esperá a que termine antes de enviar otro.' });
  }
  try {
    const response = await streamAgentTurn(
      id,
      principal,
      c.get('accessToken'),
      messageText,
      model,
      AbortSignal.any([c.req.raw.signal, turnLease.signal]),
      c.get('mcpAuth') ?? undefined,
      images,
      profile,
    );
    return await releaseTurnWhenResponseEnds(response, turnLease.release);
  } catch (error) {
    await turnLease.release().catch((releaseError: unknown) => console.error('No se pudo liberar la reserva del turno.', releaseError));
    throw error;
  }
});