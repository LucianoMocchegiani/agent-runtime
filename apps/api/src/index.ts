import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`agent-runtime listening on :${info.port}`);
});
