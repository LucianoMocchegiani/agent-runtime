import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import type { AppEnv } from './auth/principal.js';
import { config } from './config.js';

const API_PATHS = ['/v1', '/health'];

function isApiPath(path: string): boolean {
  return API_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * UI nativa (`apps/ui`) en `/`, mismo origen que la API. Montar después de las rutas de la API.
 *
 * @remarks `UI_ENABLED=false` la apaga (runtime solo como backend de otra app, vía SDK).
 */
export function mountUi(app: Hono<AppEnv>): void {
  if (!config.ui.enabled) {
    return;
  }
  if (!config.ui.dir) {
    console.warn('UI_ENABLED but no UI build found (run `npm run build` at the repo root or set UI_DIR). Serving API only.');
    return;
  }

  // serveStatic de @hono/node-server solo acepta rutas relativas al cwd.
  const root = relative(process.cwd(), config.ui.dir) || '.';
  const indexHtml = readFileSync(join(config.ui.dir, 'index.html'), 'utf-8');
  const assets = serveStatic<AppEnv>({
    root,
    onFound: (path, c) => {
      // Vite pone hash en el nombre de todo lo de assets/: se puede cachear para siempre.
      const immutable = /[\\/]assets[\\/]/.test(path);
      c.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  app.use('/*', async (c, next) => {
    if ((c.req.method !== 'GET' && c.req.method !== 'HEAD') || isApiPath(c.req.path)) {
      return next();
    }
    return assets(c, next);
  });

  app.get('*', (c) => {
    if (isApiPath(c.req.path)) {
      return c.notFound();
    }
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });

  console.log(`UI served from ${config.ui.dir}`);
}
