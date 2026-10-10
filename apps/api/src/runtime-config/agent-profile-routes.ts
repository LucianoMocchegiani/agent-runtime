import { Hono } from 'hono';
import { authorized } from './routes.js';
import { activateAgentProfile, archiveAgentProfile, createAgentProfile, listAgentProfiles, updateAgentProfile } from './agent-profiles.js';

export const agentProfileAdminRoutes = new Hono();
agentProfileAdminRoutes.use('*', async (c, next) => {
  if (!(await authorized(c.req.header('Authorization')))) return c.json({ error: 'Not authorized to manage agent profiles' }, 403);
  await next();
});
async function input(c: any): Promise<any> {
  const body = await c.req.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Body must be a JSON object');
  return body;
}
agentProfileAdminRoutes.get('/', async (c) => c.json({ items: await listAgentProfiles() }));
agentProfileAdminRoutes.post('/', async (c) => {
  try { return c.json(await createAgentProfile(await input(c)), 201); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid profile' }, 400); }
});
agentProfileAdminRoutes.post('/:id/activate', async (c) => {
  try {
    const activated = await activateAgentProfile(c.req.param('id'));
    return activated ? c.json({ ok: true }) : c.json({ error: 'Profile not found' }, 404);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid profile' }, 400); }
});
agentProfileAdminRoutes.put('/:id', async (c) => {
  try {
    const item = await updateAgentProfile(c.req.param('id'), await input(c));
    return item ? c.json(item) : c.json({ error: 'Profile not found' }, 404);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid profile' }, 400); }
});
agentProfileAdminRoutes.delete('/:id', async (c) => {
  try {
    const archived = await archiveAgentProfile(c.req.param('id'));
    return archived ? c.json({ ok: true }) : c.json({ error: 'Profile not found' }, 404);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid profile' }, 400); }
});
