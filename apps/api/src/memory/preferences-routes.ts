import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { deletePreference, listPreferences, savePreference } from 'agent-runtime-memory';
import type { AppEnv } from '../auth/principal.js';
import { decodeOptionalPreferenceCursor, encodePreferenceCursor } from './preference-cursor.js';

export const preferenceRoutes = new Hono<AppEnv>();

async function readBody(c: { req: { text: () => Promise<string> } }): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) throw new HTTPException(400, { message: 'Body must be a JSON object' });
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

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HTTPException(400, { message: `${field} must be a non-empty string` });
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new HTTPException(400, { message: `${field} must be at most ${maxLength} characters` });
  }
  return text;
}

preferenceRoutes.get('/', async (c) => {
  const rawLimit = c.req.query('limit');
  const limit = rawLimit === undefined ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new HTTPException(400, { message: 'limit debe ser un entero entre 1 y 20.' });
  }
  let before: { createdAt: string; id: string } | undefined;
  try {
    before = decodeOptionalPreferenceCursor(c.req.query('cursor'));
  } catch (error) {
    throw new HTTPException(400, { message: error instanceof Error ? error.message : 'Cursor de preferencias inválido.' });
  }
  const rows = await listPreferences({
    userId: c.get('principal').userId,
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
      ? encodePreferenceCursor({ createdAt: last.createdAt, id: last.id })
      : null,
  });
});

preferenceRoutes.post('/', async (c) => {
  const body = asRecord(await readBody(c));
  let category: string | null | undefined;
  if (body.category !== undefined) {
    if (body.category !== null && typeof body.category !== 'string') {
      throw new HTTPException(400, { message: 'category must be a string or null' });
    }
    const text = typeof body.category === 'string' ? body.category.trim() : '';
    if (text.length > 120) {
      throw new HTTPException(400, { message: 'category must be at most 120 characters' });
    }
    category = text || null;
  }
  const item = await savePreference({
    userId: c.get('principal').userId,
    preference: requiredText(body.preference, 'preference', 4000),
    activationCondition: requiredText(body.activationCondition, 'activationCondition', 2000),
    ...(category !== undefined ? { category } : {}),
  });
  return c.json(item, 201);
});

preferenceRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
    throw new HTTPException(400, { message: 'Invalid preference id' });
  }
  const deleted = await deletePreference({ userId: c.get('principal').userId, id });
  if (!deleted) throw new HTTPException(404, { message: 'Preference not found' });
  return c.body(null, 204);
});
