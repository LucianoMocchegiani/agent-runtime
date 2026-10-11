import { Hono } from 'hono';
import type { AppEnv } from '../auth/principal.js';
import { listModels } from './provider.js';
import { getNewChatDefaultAgentProfile } from '../runtime-config/agent-profiles.js';

/** Modelos habilitados para definir perfiles; el default informa el modelo elegido para nuevos chats. */
export const modelRoutes = new Hono<AppEnv>();

modelRoutes.get('/', async (c) => {
  const profile = await getNewChatDefaultAgentProfile();
  return c.json({ default: profile.modelId, items: listModels() });
});
