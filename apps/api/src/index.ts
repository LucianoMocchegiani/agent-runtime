import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './config.js';
import { startRuntimeConfigStore } from './runtime-config/store.js';

await startRuntimeConfigStore();
const app = createApp();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`agent-runtime listening on :${info.port}`);
});
