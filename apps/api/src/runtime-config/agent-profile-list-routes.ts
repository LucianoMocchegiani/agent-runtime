import { Hono } from 'hono';
import type { AppEnv } from '../auth/principal.js';
import { listAgentProfiles } from './agent-profiles.js';

export const agentProfileListRoutes = new Hono<AppEnv>();
agentProfileListRoutes.get('/', async (c) => {
  const items = await listAgentProfiles();
  return c.json({ items: items.map(({ id, name, modelId }) => ({ id, name, modelId })) });
});
