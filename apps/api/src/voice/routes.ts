import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../auth/principal.js';
import { requireConversationId } from '../conversations/ids.js';
import { getConversation } from '../conversations/service.js';
import { getRuntimeSettings } from '../runtime-config/store.js';

const OPENAI_API = 'https://api.openai.com/v1';
const SPEECH_TEXT_MAX = 4_000;

function openAiKey(): string {
  const key = getRuntimeSettings().ai.providers.openai?.apiKey;
  if (!key) throw new HTTPException(503, { message: 'La voz requiere configurar un proveedor OpenAI en Runtime.' });
  return key;
}

async function openAiError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? `OpenAI respondió HTTP ${response.status}`;
  } catch {
    return `OpenAI respondió HTTP ${response.status}`;
  }
}

export const voiceRoutes = new Hono<AppEnv>();

async function requireActiveConversation(c: Context<AppEnv>) {
  const id = requireConversationId(c.req.param('id'));
  const conversation = await getConversation(c.get('principal'), id);
  if (conversation.archivedAt) throw new HTTPException(409, { message: 'Conversation archived' });
  return id;
}

voiceRoutes.get('/status', async (c) => {
  await requireActiveConversation(c);
  return c.json({ available: Boolean(getRuntimeSettings().ai.providers.openai?.apiKey) }, 200, {
    'Cache-Control': 'no-store',
  });
});

/** Emite una credencial Realtime efímera; la clave permanente nunca sale del servidor. */
voiceRoutes.post('/token', async (c) => {
  await requireActiveConversation(c);
  const response = await fetch(`${OPENAI_API}/realtime/client_secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openAiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: 'gpt-4o-mini-transcribe', language: 'es' },
            turn_detection: { type: 'server_vad' },
          },
        },
      },
    }),
  });
  if (!response.ok) {
    console.error('No se pudo crear una credencial Realtime:', await openAiError(response));
    throw new HTTPException(502, { message: 'No se pudo iniciar el reconocimiento de voz con OpenAI.' });
  }
  const result = await response.json() as { value?: unknown; expires_at?: unknown };
  if (typeof result.value !== 'string' || !result.value) {
    throw new HTTPException(502, { message: 'OpenAI devolvió una credencial de voz inválida.' });
  }
  return c.json({ value: result.value, expiresAt: result.expires_at ?? null }, 200, {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  });
});

/** Sintetiza texto sin persistir el audio ni volver a ejecutar el turno del agente. */
voiceRoutes.post('/speech', async (c) => {
  await requireActiveConversation(c);
  let body: unknown;
  try { body = await c.req.json(); } catch { throw new HTTPException(400, { message: 'Body JSON inválido.' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { text?: unknown }).text !== 'string') {
    throw new HTTPException(400, { message: 'text debe ser una cadena.' });
  }
  const text = (body as { text: string }).text.trim();
  if (!text || text.length > SPEECH_TEXT_MAX) {
    throw new HTTPException(400, { message: `El texto de voz debe tener entre 1 y ${SPEECH_TEXT_MAX} caracteres.` });
  }
  const suppliedTraceId = c.req.header('x-voice-trace-id');
  const traceId = suppliedTraceId && /^[a-zA-Z0-9-]{1,80}$/.test(suppliedTraceId)
    ? suppliedTraceId
    : crypto.randomUUID();
  const startedAt = Date.now();
  console.info('[voice-speech] request', JSON.stringify({ traceId, textChars: text.length, model: 'tts-1' }));
  const slowRequestTimer = setTimeout(() => {
    console.warn('[voice-speech] still-pending', JSON.stringify({ traceId, elapsedMs: Date.now() - startedAt }));
  }, 10_000);
  slowRequestTimer.unref?.();

  try {
    const response = await fetch(`${OPENAI_API}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiKey()}`, 'Content-Type': 'application/json' },
      // tts-1 is optimized for lower-latency speech generation, which matters for the first audible chunk.
      body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: text, response_format: 'mp3' }),
    });
    if (!response.ok) {
      console.error('[voice-speech] upstream-error', JSON.stringify({
        traceId, status: response.status, durationMs: Date.now() - startedAt,
        message: await openAiError(response),
      }));
      throw new HTTPException(502, { message: 'No se pudo generar el audio de la respuesta.' });
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    console.info('[voice-speech] complete', JSON.stringify({
      traceId, status: response.status, durationMs: Date.now() - startedAt, audioBytes: audio.byteLength,
    }));
    return c.body(audio, 200, {
      'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
      'Cache-Control': 'no-store',
      'Content-Disposition': 'inline',
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      console.error('[voice-speech] request-rejected', JSON.stringify({
        traceId, status: error.status, durationMs: Date.now() - startedAt,
      }));
      throw error;
    }
    console.error('[voice-speech] network-error', JSON.stringify({
      traceId, durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
    throw new HTTPException(502, { message: 'No se pudo generar el audio de la respuesta.' });
  } finally {
    clearTimeout(slowRequestTimer);
  }
});
