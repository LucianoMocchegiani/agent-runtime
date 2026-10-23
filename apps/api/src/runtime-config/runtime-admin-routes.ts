import { Hono } from 'hono';
import type { AppEnv } from '../auth/contracts.js';
import { authorizedAdminRequest } from './authorization.js';
import { addRuntimeAdmin, LastRuntimeAdminError, listRuntimeAdmins, removeRuntimeAdmin } from './admin-persistence.js';

/** Gestión de administradores, accesible solo a administradores actualmente autorizados. */
export const runtimeAdminRoutes = new Hono<AppEnv>();

runtimeAdminRoutes.use('*', async (c, next) => {
  const principal = await authorizedAdminRequest(c);
  if (!principal) return c.json({ error: 'Not authorized to manage runtime administrators' }, 403);
  c.set('principal', principal);
  await next();
});

runtimeAdminRoutes.get('/', async (c) => {
  const items = await listRuntimeAdmins();
  return c.json({ items: items.map((item) => ({
    userId: item.userId,
    createdAt: item.createdAt.toISOString(),
    createdByUserId: item.createdByUserId,
  })) });
});

runtimeAdminRoutes.post('/', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Expected an object' }, 400);
  const userId = (body as Record<string, unknown>).userId;
  if (typeof userId !== 'string' || !userId.trim() || userId.trim().length > 255) {
    return c.json({ error: 'userId must be a non-empty string of at most 255 characters' }, 400);
  }
  const item = await addRuntimeAdmin(userId.trim(), c.get('principal').userId);
  return c.json({ item: { userId: item.userId, createdAt: item.createdAt.toISOString(), createdByUserId: item.createdByUserId } }, 201);
});

runtimeAdminRoutes.delete('/:userId', async (c) => {
  const userId = c.req.param('userId').trim();
  if (!userId) return c.json({ error: 'userId is required' }, 400);
  try {
    const removed = await removeRuntimeAdmin(userId);
    if (!removed) return c.json({ error: 'Runtime administrator not found' }, 404);
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof LastRuntimeAdminError) return c.json({ error: error.message }, 409);
    throw error;
  }
});
