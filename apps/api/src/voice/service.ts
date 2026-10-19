import type { AiProviderVoiceConfig } from '../config.js';
import { getRuntimeSettings } from '../runtime-config/service.js';
import type { AgentProfileVoiceConfig } from '../runtime-config/contracts.js';
import {
  VOICE_REALTIME_SAMPLE_RATE_HZ,
  VOICE_SLOW_REQUEST_LOG_MS,
  VOICE_SPEECH_FORMAT,
  VOICE_TURN_SILENCE_MS,
} from './constants.js';

/** Error de integración con el proveedor, traducible a una respuesta HTTP en las rutas. */
export class VoiceServiceError extends Error {
  constructor(message: string, readonly status: 502 | 503) {
    super(message);
    this.name = 'VoiceServiceError';
  }
}

type VoiceRuntime = { key: string; provider: AiProviderVoiceConfig; profile: AgentProfileVoiceConfig };

function resolveVoiceRuntime(profile: AgentProfileVoiceConfig | undefined): VoiceRuntime | null {
  if (!profile) return null;
  const provider = getRuntimeSettings().ai.providers.openai;
  const voiceProvider = provider?.voice;
  if (!provider?.apiKey || !voiceProvider
    || !voiceProvider.transcriptionModels.includes(profile.transcriptionModel)
    || !voiceProvider.speechModels.includes(profile.speechModel)
    || !voiceProvider.speechVoices.includes(profile.speechVoice)) return null;
  return { key: provider.apiKey, provider: voiceProvider, profile };
}

/** Solo informa disponibilidad si el perfil habilitó voz y su catálogo sigue configurado. */
export function isVoiceAvailable(profile: AgentProfileVoiceConfig | undefined): boolean {
  return resolveVoiceRuntime(profile) !== null;
}

function requireVoiceRuntime(profile: AgentProfileVoiceConfig | undefined): VoiceRuntime {
  const runtime = resolveVoiceRuntime(profile);
  if (!runtime) throw new VoiceServiceError('La voz no está habilitada en el perfil o su proveedor no está disponible.', 503);
  return runtime;
}

async function openAiError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? `El proveedor de voz respondió HTTP ${response.status}`;
  } catch {
    return `El proveedor de voz respondió HTTP ${response.status}`;
  }
}

/** Solicita credencial efímera para transcripción sin exponer la clave permanente. */
export async function createRealtimeVoiceToken(profile: AgentProfileVoiceConfig | undefined): Promise<{ value: string; expiresAt: unknown }> {
  const runtime = requireVoiceRuntime(profile);
  let response: Response;
  try {
    response = await fetch(`${runtime.provider.baseUrl}/realtime/client_secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${runtime.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: VOICE_REALTIME_SAMPLE_RATE_HZ },
              transcription: { model: runtime.profile.transcriptionModel, language: runtime.profile.language },
              turn_detection: { type: 'server_vad', silence_duration_ms: VOICE_TURN_SILENCE_MS },
            },
          },
        },
      }),
    });
  } catch {
    throw new VoiceServiceError('No se pudo iniciar el reconocimiento de voz con el proveedor configurado.', 502);
  }
  if (!response.ok) {
    console.error('No se pudo crear una credencial Realtime:', await openAiError(response));
    throw new VoiceServiceError('No se pudo iniciar el reconocimiento de voz con el proveedor configurado.', 502);
  }
  let result: { value?: unknown; expires_at?: unknown };
  try {
    result = await response.json() as { value?: unknown; expires_at?: unknown };
  } catch {
    throw new VoiceServiceError('El proveedor devolvió una credencial de voz inválida.', 502);
  }
  if (typeof result.value !== 'string' || !result.value) {
    throw new VoiceServiceError('El proveedor devolvió una credencial de voz inválida.', 502);
  }
  return { value: result.value, expiresAt: result.expires_at ?? null };
}

/** Sintetiza texto y devuelve audio binario; no persiste el audio ni ejecuta turnos del agente. */
export async function synthesizeVoiceSpeech(
  text: string,
  traceId: string,
  profile: AgentProfileVoiceConfig | undefined,
): Promise<{ audio: Uint8Array<ArrayBuffer>; contentType: string }> {
  const runtime = requireVoiceRuntime(profile);
  const startedAt = Date.now();
  console.info('[voice-speech] request', JSON.stringify({ traceId, textChars: text.length, model: runtime.profile.speechModel }));
  const slowRequestTimer = setTimeout(() => {
    console.warn('[voice-speech] still-pending', JSON.stringify({ traceId, elapsedMs: Date.now() - startedAt }));
  }, VOICE_SLOW_REQUEST_LOG_MS);
  slowRequestTimer.unref?.();

  try {
    let response: Response;
    try {
      response = await fetch(`${runtime.provider.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${runtime.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: runtime.profile.speechModel,
          voice: runtime.profile.speechVoice,
          input: text,
          response_format: VOICE_SPEECH_FORMAT,
        }),
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
