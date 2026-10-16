import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../auth/principal.js';
import { getDelegationForUser, listDelegationEvents, listDelegationsForUser } from './store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR = /^\d{1,18}$/;

function readCursor(raw: string | undefined): string {
  if (raw === undefined || raw === '') return '0';
  if (!CURSOR.test(raw)) throw new HTTPException(400, { message: 'Cursor de eventos inválido.' });
  return raw;
}

/** Rutas para consultar delegaciones propias y seguir sus eventos por SSE. */
export const delegationRoutes = new Hono<AppEnv>();

delegationRoutes.get('/', async (c) => {
  const items = await listDelegationsForUser(c.get('principal').userId);
  return c.json({ items });
});

delegationRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID.test(id)) throw new HTTPException(404, { message: 'Delegación no encontrada.' });
  const job = await getDelegationForUser(id, c.get('principal').userId);
  if (!job) throw new HTTPException(404, { message: 'Delegación no encontrada.' });
  return c.json(job);
});

delegationRoutes.get('/:id/events', async (c) => {
  const id = c.req.param('id');
  if (!UUID.test(id)) throw new HTTPException(404, { message: 'Delegación no encontrada.' });
  const userId = c.get('principal').userId;
  const job = await getDelegationForUser(id, userId);
  if (!job) throw new HTTPException(404, { message: 'Delegación no encontrada.' });
  let cursor = readCursor(c.req.header('Last-Event-ID') ?? c.req.query('after'));
  let cancelled = false;
  let lastHeartbeat = Date.now();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (value: string) => controller.enqueue(encoder.encode(value));
      void (async () => {
        try {
          while (!cancelled) {
            const events = await listDelegationEvents(id, cursor);
            for (const event of events) {
              cursor = event.id;
              send(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
            }
            const current = await getDelegationForUser(id, userId);
            if (!current) break;
            if (Date.now() - lastHeartbeat >= 15_000) {
              send(': keep-alive\n\n');
              lastHeartbeat = Date.now();
            }
            if (['completed', 'failed', 'interrupted'].includes(current.status) && events.length === 0) break;
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
        } catch {
          // El cliente puede desconectarse entre polls; los eventos persisten y se recuperan al reconectar.
        } finally {
          try { controller.close(); } catch { /* cancelado */ }
        }
      })();
    },
    cancel() { cancelled = true; },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
