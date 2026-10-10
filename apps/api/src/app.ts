import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { requirePrincipal } from './auth/middleware.js';
import type { AppEnv } from './auth/principal.js';
import { config } from './config.js';
import { allowCorsOrigin } from './cors.js';
import { conversationRoutes } from './conversations/routes.js';
import { modelRoutes } from './llm/routes.js';
import { createMemoryMcpClient } from './memory/client.js';
import { messageRoutes } from './messages/routes.js';
import { internalRuntimeConfigRoutes, runtimeConfigRoutes } from './runtime-config/routes.js';
import { agentProfileAdminRoutes } from './runtime-config/agent-profile-routes.js';
import { agentProfileListRoutes } from './runtime-config/agent-profile-list-routes.js';
import { mountUi } from './ui.js';

type DependencyStatus = 'up' | 'down';

const HEALTH_TIMEOUT_MS = 3000;

/** Handshake MCP + tools requeridas: sirve para cualquier implementación de memoria, no solo la default. */
async function pingMemory(): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), HEALTH_TIMEOUT_MS);
  });
  const pending = createMemoryMcpClient();
  try {
    const memory = await Promise.race([pending, timeout]);
    await memory.close();
    return 'up';
  } catch {
    pending.then((memory) => memory.close(), () => undefined);
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * App HTTP del agent-runtime: CORS, health, `/v1` autenticado y UI nativa en `/`.
 */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(
    '*',
    cors({
      origin: (origin) =>
        origin
          ? allowCorsOrigin(origin, config.corsOrigins, config.corsAppDomain)
          : '*',
      allowHeaders: [
        'Authorization',
        'Content-Type',
        'x-vercel-ai-ui-message-stream',
        'X-MCP-Auth',
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const status = err.status as 400 | 401 | 403 | 404 | 429 | 502 | 500 | 503;
      return c.json({ error: err.message }, status);
    }
    console.error(err);
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  /** Probe de proceso + ping al Memory MCP; la DB de runtime es otra dependencia del proceso. */
  app.get('/health', async (c) => {
    const memory = await pingMemory();
    return c.json(
      {
        status: memory === 'up' ? 'ok' : 'degraded',
        memory,
        checkedAt: new Date().toISOString(),
      },
      memory === 'up' ? 200 : 503,
    );
  });

  app.route('/admin/runtime-config', runtimeConfigRoutes);
  app.route('/admin/agent-profiles', agentProfileAdminRoutes);
  app.route('/internal/runtime-config', internalRuntimeConfigRoutes);

  const v1 = new Hono<AppEnv>();
  v1.use('*', requirePrincipal);
  v1.route('/conversations/:id/messages', messageRoutes);
  v1.route('/conversations', conversationRoutes);
  v1.route('/models', modelRoutes);
  v1.route('/agent-profiles', agentProfileListRoutes);
  app.route('/v1', v1);

  mountUi(app);

  return app;
}