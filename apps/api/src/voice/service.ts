import { getRuntimeSettings } from '../runtime-config/service.js';
import {
  VOICE_OPENAI_API_URL,
  VOICE_REALTIME_SAMPLE_RATE_HZ,
  VOICE_SLOW_REQUEST_LOG_MS,
  VOICE_SPEECH_FORMAT,
  VOICE_SPEECH_MODEL,
  VOICE_SPEECH_VOICE,
  VOICE_TRANSCRIPTION_MODEL,
  VOICE_TURN_SILENCE_MS,
} from './constants.js';

/** Error de integración con el proveedor, traducible a una respuesta HTTP en las rutas. */
export class VoiceServiceError extends Error {
  constructor(message: string, readonly status: 502 | 503) {
    super(message);
    this.name = 'VoiceServiceError';
  }
}

/** Indica si Runtime tiene una credencial OpenAI disponible para las funciones de voz. */
export function isVoiceAvailable(): boolean {
  return Boolean(getRuntimeSettings().ai.providers.openai?.apiKey);
}

function openAiKey(): string {
  const key = getRuntimeSettings().ai.providers.openai?.apiKey;
  if (!key) throw new VoiceServiceError('La voz requiere configurar un proveedor OpenAI en Runtime.', 503);
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

/** Solicita una credencial efímera para transcripción Realtime sin exponer la clave permanente. */
export async function createRealtimeVoiceToken(): Promise<{ value: string; expiresAt: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${VOICE_OPENAI_API_URL}/realtime/client_secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: VOICE_REALTIME_SAMPLE_RATE_HZ },
              transcription: { model: VOICE_TRANSCRIPTION_MODEL, language: 'es' },
              turn_detection: { type: 'server_vad', silence_duration_ms: VOICE_TURN_SILENCE_MS },
            },
          },
        },
      }),
    });
  } catch {
    throw new VoiceServiceError('No se pudo iniciar el reconocimiento de voz con OpenAI.', 502);
  }
  if (!response.ok) {
    console.error('No se pudo crear una credencial Realtime:', await openAiError(response));
    throw new VoiceServiceError('No se pudo iniciar el reconocimiento de voz con OpenAI.', 502);
  }
  let result: { value?: unknown; expires_at?: unknown };
  try {
    result = await response.json() as { value?: unknown; expires_at?: unknown };
  } catch {
    throw new VoiceServiceError('OpenAI devolvió una credencial de voz inválida.', 502);
  }
  if (typeof result.value !== 'string' || !result.value) {
    throw new VoiceServiceError('OpenAI devolvió una credencial de voz inválida.', 502);
  }
  return { value: result.value, expiresAt: result.expires_at ?? null };
}

/** Sintetiza texto y devuelve audio binario; no persiste el audio ni ejecuta turnos del agente. */
export async function synthesizeVoiceSpeech(text: string, traceId: string): Promise<{ audio: Uint8Array<ArrayBuffer>; contentType: string }> {
  const startedAt = Date.now();
  console.info('[voice-speech] request', JSON.stringify({ traceId, textChars: text.length, model: VOICE_SPEECH_MODEL }));
  const slowRequestTimer = setTimeout(() => {
    console.warn('[voice-speech] still-pending', JSON.stringify({ traceId, elapsedMs: Date.now() - startedAt }));
  }, VOICE_SLOW_REQUEST_LOG_MS);
  slowRequestTimer.unref?.();

  try {
    let response: Response;
    try {
      response = await fetch(`${VOICE_OPENAI_API_URL}/audio/speech`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: VOICE_SPEECH_MODEL, voice: VOICE_SPEECH_VOICE, input: text, response_format: VOICE_SPEECH_FORMAT }),
      });
    } catch {
      throw new VoiceServiceError('No se pudo generar el audio de la respuesta.', 502);
    }
    if (!response.ok) {
      console.error('[voice-speech] upstream-error', JSON.stringify({
        traceId, status: response.status, durationMs: Date.now() - startedAt,
        message: await openAiError(response),
      }));
      throw new VoiceServiceError('No se pudo generar el audio de la respuesta.', 502);
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    console.info('[voice-speech] complete', JSON.stringify({
      traceId, status: response.status, durationMs: Date.now() - startedAt, audioBytes: audio.byteLength,
    }));
    return { audio, contentType: response.headers.get('Content-Type') || 'audio/mpeg' };
  } catch (error) {
    if (error instanceof VoiceServiceError) {
      console.error('[voice-speech] request-rejected', JSON.stringify({
        traceId, status: error.status, durationMs: Date.now() - startedAt,
      }));
      throw error;
    }
    console.error('[voice-speech] network-error', JSON.stringify({
      traceId, durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
    throw new VoiceServiceError('No se pudo generar el audio de la respuesta.', 502);
  } finally {
    clearTimeout(slowRequestTimer);
  }
}
