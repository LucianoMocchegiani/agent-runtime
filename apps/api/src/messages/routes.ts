import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamAgentTurn } from '../agent/run.js';
import type { AppEnv } from '../auth/principal.js';
import { config } from '../config.js';
import { createMemoryMcpClient } from '../memory/client.js';
import { requireConversationId } from '../conversations/ids.js';
import { getConversation } from '../conversations/service.js';
import { resolveModel, type ResolvedModel } from '../llm/provider.js';

const TEXT_MAX = 8000;

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

function readText(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HTTPException(400, { message: 'Body must be a JSON object' });
  }
  const text = (body as { text?: unknown }).text;
  if (typeof text !== 'string') {
    throw new HTTPException(400, { message: 'text must be a string' });
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new HTTPException(400, { message: 'text is required' });
  }
  if (trimmed.length > TEXT_MAX) {
    throw new HTTPException(400, { message: `text max ${TEXT_MAX} chars` });
  }
  return trimmed;
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
  const model = readModel(body);
  const principal = c.get('principal');
  return streamAgentTurn(
    id,
    principal,
    c.get('accessToken'),
    text,
    config.chatSystemPrompt,
    model,
    c.req.raw.signal,
    c.get('mcpAuth') ?? undefined,
  );
});