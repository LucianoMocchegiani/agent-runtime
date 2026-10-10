import { Hono } from 'hono';
import type { AppEnv } from '../auth/principal.js';
import { listModels } from './provider.js';
import { getDefaultAgentProfile } from '../runtime-config/agent-profiles.js';

/** Modelos habilitados para definir perfiles; los turnos usan el modelo del perfil global activo. */
export const modelRoutes = new Hono<AppEnv>();

modelRoutes.get('/', async (c) => {
  const profile = await getDefaultAgentProfile();
  return c.json({ default: profile.modelId, items: listModels() });
});
