import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../auth/principal.js';
import { getAgentProfile, getNewChatDefaultAgentProfile } from '../runtime-config/agent-profiles.js';
import { requireConversationId } from './ids.js';
import { decodeOptionalConversationCursor, encodeConversationCursor } from '../agent/conversation-cursor.js';
import { readJsonBody } from '../http/request-body.js';
import {
  archiveConversation,
  createConversation,
  getConversation,
  listConversations,
  parseTitleInput,
  updateConversation,
} from './service.js';

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HTTPException(400, { message: 'Body must be a JSON object' });
  }
  return value as Record<string, unknown>;
}

/**
 * CRUD de hilos. Aislado por tenant+user del Bearer.
 */
export const conversationRoutes = new Hono<AppEnv>();

conversationRoutes.get('/', async (c) => {
  const archived = c.req.query('archived') === 'true';
  const scope = archived ? 'archived' : 'active';
  const rawLimit = c.req.query('limit');
  const limit = rawLimit === undefined ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new HTTPException(400, { message: 'limit debe ser un entero entre 1 y 20.' });
  }
  let before: { updatedAt: string; id: string } | undefined;
  try {
    before = decodeOptionalConversationCursor(c.req.query('cursor'), scope);
  } catch (error) {
    throw new HTTPException(400, { message: error instanceof Error ? error.message : 'Cursor de conversaciones inválido.' });
  }
  const rows = await listConversations(c.get('principal'), archived, {
    limit: limit + 1,
    ...(before ? { before } : {}),
  });
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const hasMore = rows.length > limit;
  return c.json({
    items,
    hasMore,
    nextCursor: hasMore && last
      ? encodeConversationCursor({ updatedAt: last.updatedAt, id: last.id, scope })
      : null,
  });
});

conversationRoutes.post('/', async (c) => {
  const body = asRecord(await readJsonBody(c.req.raw));
  const title = parseTitleInput(body.title);
  let profileId: string;
  if (body.agentProfileId === undefined || body.agentProfileId === null) {
    profileId = (await getNewChatDefaultAgentProfile()).id;
  } else if (typeof body.agentProfileId === 'string' && body.agentProfileId.trim()) {
    const profile = await getAgentProfile(body.agentProfileId.trim());
    if (!profile) throw new HTTPException(400, { message: 'El perfil seleccionado no existe o está archivado.' });
    profileId = profile.id;
  } else {
    throw new HTTPException(400, { message: 'agentProfileId debe ser un identificador de perfil.' });
  }
  const created = await createConversation(
    c.get('principal'),
    title === undefined ? null : title,
    profileId,
  );
  return c.json(created, 201);
});

conversationRoutes.get('/:id', async (c) => {
  const id = requireConversationId(c.req.param('id'));
  const row = await getConversation(c.get('principal'), id);
  return c.json(row);
});

conversationRoutes.patch('/:id', async (c) => {
  const id = requireConversationId(c.req.param('id'));
  const body = asRecord(await readJsonBody(c.req.raw));
  const title = parseTitleInput(body.title);
  let agentProfileId: string | undefined;
  if (body.agentProfileId === null) {
    agentProfileId = (await getNewChatDefaultAgentProfile()).id;
  } else if (body.agentProfileId !== undefined) {
    if (typeof body.agentProfileId !== 'string' || !body.agentProfileId.trim()) {
      throw new HTTPException(400, { message: 'agentProfileId debe ser un identificador de perfil.' });
    }
    const profile = await getAgentProfile(body.agentProfileId.trim());
    if (!profile) throw new HTTPException(400, { message: 'El perfil seleccionado no existe o está archivado.' });
    agentProfileId = profile.id;
  }
  let archived: boolean | undefined;
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') {
      throw new HTTPException(400, { message: 'archived must be boolean' });
    }
    archived = body.archived;
  }
  const row = await updateConversation(c.get('principal'), id, {
    ...(title !== undefined ? { title } : {}),
    ...(archived !== undefined ? { archived } : {}),
    ...(agentProfileId !== undefined ? { agentProfileId } : {}),
  });
  return c.json(row);
});

conversationRoutes.delete('/:id', async (c) => {
  const id = requireConversationId(c.req.param('id'));
  const row = await archiveConversation(c.get('principal'), id);
  return c.json(row);
});
