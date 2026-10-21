import type { AiProviderRealtimeConfig } from '../config.js';
import { getRuntimeSettings } from '../runtime-config/service.js';
import type { AgentProfileRealtimeConfig } from '../runtime-config/contracts.js';

/** Error de integración con el proveedor, traducible a una respuesta HTTP en las rutas. */
export class VoiceServiceError extends Error {
  constructor(message: string, readonly status: 502 | 503) {
    super(message);
    this.name = 'VoiceServiceError';
  }
}

type VoiceRuntime = { key: string; baseUrl: string; realtime: AiProviderRealtimeConfig; realtimeModels: string[] };

function resolveVoiceRuntime(profile: AgentProfileRealtimeConfig | undefined): VoiceRuntime | null {
  if (!profile) return null;
  const provider = getRuntimeSettings().ai.providers.openai;
  const realtime = provider?.realtime;
  const baseUrl = provider?.baseUrl;
  const realtimeModels = provider?.models.realtime ?? [];
  if (!provider?.apiKey || !baseUrl || !realtime || !realtimeModels.length) return null;
  return { key: provider.apiKey, baseUrl, realtime, realtimeModels };
}

/** Solo informa disponibilidad si el perfil habilitó un modelo y una voz Realtime. */
export function isVoiceAvailable(profile: AgentProfileRealtimeConfig | undefined, model: string | undefined): boolean {
  const runtime = resolveVoiceRuntime(profile);
  return Boolean(runtime && model
    && runtime.realtimeModels.includes(model)
    && runtime.realtime.voices.includes(profile!.voice));
}

/** Crea un secreto efímero para WebRTC; la clave permanente OpenAI nunca sale del backend. */
export async function createRealtimeVoiceSession(
  profile: AgentProfileRealtimeConfig | undefined,
  model: string | undefined,
  instructions: string,
  tools: Array<Record<string, unknown>> = [],
): Promise<{ value: string; expiresAt: number | null; realtimeUrl: string }> {
  const runtime = requireVoiceRuntime(profile, model);
  if (!model || !isVoiceAvailable(profile, model)) {
    throw new VoiceServiceError('El perfil no tiene capacidades Realtime habilitadas.', 503);
  }
  let response: Response;
  try {
    response = await fetch(`${runtime.baseUrl}/realtime/client_secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${runtime.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model,
          instructions,
          max_output_tokens: profile!.maxOutputTokens,
          audio: {
            input: {
              turn_detection: {
                type: 'server_vad',
                threshold: profile!.vad.threshold,
                prefix_padding_ms: profile!.vad.prefixPaddingMs,
                silence_duration_ms: profile!.vad.silenceDurationMs,
                create_response: profile!.vad.createResponse,
                interrupt_response: profile!.vad.interruptResponse,
              },
            },
            output: { voice: profile!.voice },
          },
          tools,
          tool_choice: tools.length ? 'auto' : 'none',
        },
      }),
    });
  } catch {
    throw new VoiceServiceError('No se pudo iniciar la sesión de voz en tiempo real.', 502);
  }
  if (!response.ok) {
    console.error('[voice-realtime] upstream-error', JSON.stringify({ status: response.status, message: await openAiError(response) }));
    throw new VoiceServiceError('No se pudo iniciar la sesión de voz en tiempo real.', 502);
  }
  let result: { value?: unknown; expires_at?: unknown };
  try { result = await response.json() as typeof result; }
  catch { throw new VoiceServiceError('El proveedor devolvió credenciales Realtime inválidas.', 502); }
  if (typeof result.value !== 'string' || !result.value) {
    throw new VoiceServiceError('El proveedor devolvió credenciales Realtime inválidas.', 502);
  }
  return {
    value: result.value,
    expiresAt: typeof result.expires_at === 'number' ? result.expires_at : null,
    realtimeUrl: `${runtime.baseUrl}/realtime/calls`,
  };
}

function requireVoiceRuntime(profile: AgentProfileRealtimeConfig | undefined, model: string | undefined): VoiceRuntime {
  const runtime = resolveVoiceRuntime(profile);
  if (!runtime || !isVoiceAvailable(profile, model)) {
    throw new VoiceServiceError('La voz no está habilitada en el perfil o su proveedor no está disponible.', 503);
  }
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
