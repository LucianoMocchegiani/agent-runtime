import { Hono } from 'hono';
import type { AppEnv } from '../auth/contracts.js';
import { listAgentProfiles } from './agent-profiles.js';

/** Endpoint autenticado que publica los metadatos mínimos de perfiles activos. */
export const agentProfileListRoutes = new Hono<AppEnv>();
agentProfileListRoutes.get('/', async (c) => {
  const items = await listAgentProfiles();
  return c.json({ items: items.map(({ id, name, modelId }) => ({ id, name, modelId })) });
});
