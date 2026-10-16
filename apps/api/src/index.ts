import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './config.js';
import { startRuntimeConfigStore } from './runtime-config/store.js';
import { startEmbeddingWorker } from './memory-search/service.js';
import { startDelegationWorker } from './delegations/worker.js';

await startRuntimeConfigStore();
startEmbeddingWorker();
startDelegationWorker();
const app = createApp();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`agent-runtime listening on :${info.port}`);
});
