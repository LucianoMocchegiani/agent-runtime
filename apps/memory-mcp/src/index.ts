import { serve } from '@hono/node-server';
import { config } from './config.js';
import { createApp } from './server.js';
import { startEmbeddingWorker } from './search/service.js';

const app = createApp();
startEmbeddingWorker();

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`memory-mcp listening on ${config.host}:${info.port}`);
});
