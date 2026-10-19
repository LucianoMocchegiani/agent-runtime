import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../auth/contracts.js';
import { requireConversationId } from '../conversations/ids.js';
import { getConversation } from '../conversations/service.js';
import { getAgentProfile } from '../runtime-config/agent-profiles.js';
import type { AgentProfileVoiceConfig } from '../runtime-config/contracts.js';
import { VOICE_SPEECH_TEXT_MAX_LENGTH, VOICE_TRACE_ID_PATTERN } from './constants.js';
import { createRealtimeVoiceToken, isVoiceAvailable, synthesizeVoiceSpeech, VoiceServiceError } from './service.js';

/** Rutas HTTP de disponibilidad, credenciales y síntesis de voz por conversación. */
export const voiceRoutes = new Hono<AppEnv>();

async function conversationVoiceProfile(c: Context<AppEnv>): Promise<AgentProfileVoiceConfig | undefined> {
  const id = requireConversationId(c.req.param('id'));
  const conversation = await getConversation(c.get('principal'), id);
  if (conversation.archivedAt) throw new HTTPException(409, { message: 'Conversation archived' });
  if (!conversation.agentProfileId) return undefined;
  const profile = await getAgentProfile(conversation.agentProfileId, true);
  return profile?.config.voice;
}

function asHttpException(error: unknown): never {
  if (error instanceof VoiceServiceError) throw new HTTPException(error.status, { message: error.message });
  throw error;
}

voiceRoutes.get('/status', async (c) => {
  const voiceProfile = await conversationVoiceProfile(c);
  return c.json({ available: isVoiceAvailable(voiceProfile) }, 200, { 'Cache-Control': 'no-store' });
});

/** Emite una credencial Realtime efímera; la clave permanente nunca sale del servidor. */
voiceRoutes.post('/token', async (c) => {
  const voiceProfile = await conversationVoiceProfile(c);
  try {
    const result = await createRealtimeVoiceToken(voiceProfile);
    return c.json(result, 200, { 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  } catch (error) {
    asHttpException(error);
  }
});

/** Sintetiza texto sin persistir el audio ni volver a ejecutar el turno del agente. */
voiceRoutes.post('/speech', async (c) => {
  const voiceProfile = await conversationVoiceProfile(c);
  let body: unknown;
  try { body = await c.req.json(); } catch { throw new HTTPException(400, { message: 'Body JSON inválido.' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { text?: unknown }).text !== 'string') {
    throw new HTTPException(400, { message: 'text debe ser una cadena.' });
  }
  const text = (body as { text: string }).text.trim();
  if (!text || text.length > VOICE_SPEECH_TEXT_MAX_LENGTH) {
    throw new HTTPException(400, { message: `El texto de voz debe tener entre 1 y ${VOICE_SPEECH_TEXT_MAX_LENGTH} caracteres.` });
  }
  const suppliedTraceId = c.req.header('x-voice-trace-id');
  const traceId = suppliedTraceId && VOICE_TRACE_ID_PATTERN.test(suppliedTraceId)
    ? suppliedTraceId
    : crypto.randomUUID();
  try {
    const { audio, contentType } = await synthesizeVoiceSpeech(text, traceId, voiceProfile);
    return c.body(audio, 200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Content-Disposition': 'inline',
    });
  } catch (error) {
    asHttpException(error);
  }
});
