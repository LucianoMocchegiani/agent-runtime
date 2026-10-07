import { Hono } from 'hono';
import type { AppEnv } from '../auth/principal.js';
import { defaultModelId, listModels } from './provider.js';

/**
 * Modelos elegibles por el cliente. El cliente manda `id` como `model` en POST de mensajes.
 */
export const modelRoutes = new Hono<AppEnv>();

modelRoutes.get('/', (c) => {
  return c.json({ default: defaultModelId(), items: listModels() });
});
