import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../auth/contracts.js';
import { getDelegationForUser, listDelegationEvents, listDelegationsForUser } from './persistence.js';
import {
  DELEGATION_CURSOR_PATTERN,
  DELEGATION_ID_PATTERN,
  DELEGATION_SSE_HEARTBEAT_MS,
  DELEGATION_TERMINAL_STATUSES,
  DELEGATION_WORKER_POLL_INTERVAL_MS,
} from './constants.js';

function readCursor(raw: string | undefined): string {
  if (raw === undefined || raw === '') return '0';
  if (!DELEGATION_CURSOR_PATTERN.test(raw)) throw new HTTPException(400, { message: 'Cursor de eventos inválido.' });
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
  if (!DELEGATION_ID_PATTERN.test(id)) throw new HTTPException(404, { message: 'Delegación no encontrada.' });
  const job = await getDelegationForUser(id, c.get('principal').userId);
  if (!job) throw new HTTPException(404, { message: 'Delegación no encontrada.' });
  return c.json(job);
});

delegationRoutes.get('/:id/events', async (c) => {
  const id = c.req.param('id');
  if (!DELEGATION_ID_PATTERN.test(id)) throw new HTTPException(404, { message: 'Delegación no encontrada.' });
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
            if (Date.now() - lastHeartbeat >= DELEGATION_SSE_HEARTBEAT_MS) {
              send(': keep-alive\n\n');
              lastHeartbeat = Date.now();
            }
            if ((DELEGATION_TERMINAL_STATUSES as readonly string[]).includes(current.status) && events.length === 0) break;
            await new Promise((resolve) => setTimeout(resolve, DELEGATION_WORKER_POLL_INTERVAL_MS));
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
