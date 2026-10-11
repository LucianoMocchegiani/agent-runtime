import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../auth/principal.js';
import { getAgentProfile, getNewChatDefaultAgentProfile } from '../runtime-config/agent-profiles.js';
import { requireConversationId } from './ids.js';
import {
  archiveConversation,
  createConversation,
  getConversation,
  listConversations,
  parseTitleInput,
  updateConversation,
} from './service.js';

async function readJsonBody(c: { req: { text: () => Promise<string> } }): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON' });
  }
}

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
  const items = await listConversations(c.get('principal'), archived);
  return c.json({ items });
});

conversationRoutes.post('/', async (c) => {
  const body = asRecord(await readJsonBody(c));
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
  const body = asRecord(await readJsonBody(c));
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
