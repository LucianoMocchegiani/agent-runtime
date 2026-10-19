/** Longitud máxima del texto aceptado por el endpoint de síntesis. */
export const VOICE_SPEECH_TEXT_MAX_LENGTH = 4_000;

/** Formato PCM y frecuencia que espera la sesión de transcripción Realtime. */
export const VOICE_REALTIME_SAMPLE_RATE_HZ = 24_000;

/** Silencio requerido para que el detector de voz cierre una intervención. */
export const VOICE_TURN_SILENCE_MS = 2_000;

/** Formato de audio devuelto por el proveedor de síntesis. */
export const VOICE_SPEECH_FORMAT = 'mp3';

/** Umbral a partir del que se registra que la generación sigue pendiente. */
export const VOICE_SLOW_REQUEST_LOG_MS = 10_000;

/** Formato aceptado para correlacionar una petición de síntesis con sus logs. */
export const VOICE_TRACE_ID_PATTERN = /^[a-zA-Z0-9-]{1,80}$/;
