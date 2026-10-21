import { Hono } from 'hono';
import type { AppEnv } from '../auth/contracts.js';
import { listModels } from './provider.js';
import { getNewChatDefaultAgentProfile } from '../runtime-config/agent-profiles.js';

/** Modelos habilitados para definir perfiles; el default informa el modelo elegido para nuevos chats. */
/** Endpoint autenticado que lista modelos habilitados y el predeterminado de chats nuevos. */
export const modelRoutes = new Hono<AppEnv>();

modelRoutes.get('/', async (c) => {
  const profile = await getNewChatDefaultAgentProfile();
  return c.json({ default: profile.model.chat, items: listModels() });
});
