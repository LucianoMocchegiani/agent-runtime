/** Intervalo para detectar cambios de configuración persistida en otras réplicas. */
export const RUNTIME_CONFIG_RELOAD_INTERVAL_MS = 3_000;

/** Máximo de conexiones del pool dedicado a runtime.config y perfiles. */
export const RUNTIME_CONFIG_DB_POOL_MAX = 5;

/** Tiempo máximo para establecer una conexión al PostgreSQL de configuración. */
export const RUNTIME_CONFIG_DB_CONNECT_TIMEOUT_MS = 5_000;

/** Límite superior del nombre de un perfil de agente. */
export const AGENT_PROFILE_NAME_MAX_LENGTH = 100;

/** Límite superior del prompt de sistema de un perfil. */
export const AGENT_PROFILE_PROMPT_MAX_LENGTH = 100_000;

/** Máximo permitido para los presupuestos y límites enteros de un perfil. */
export const AGENT_PROFILE_INTEGER_MAX = 10_000_000;

/** Nombre mostrado al crear por migración el primer perfil de agente. */
export const DEFAULT_AGENT_PROFILE_NAME = 'Predeterminado';

/** Identificador estable del único registro de configuración activa. */
export const ACTIVE_RUNTIME_CONFIG_ID = 'active';

/** Identificador estable de la preferencia de perfil predeterminado para chats nuevos. */
export const DEFAULT_PROFILE_PREFERENCE_ID = 'default';

/** Marcador que oculta credenciales en las respuestas administrativas. */
export const RUNTIME_CONFIG_SECRET_MASK = '********';

/** Nombre de usuario reservado como fallback para el acceso bootstrap inicial. */
export const RUNTIME_CONFIG_BOOTSTRAP_ADMIN_USER = 'admin';

/** Proveedores admitidos por el formato de configuración persistida. */
export const RUNTIME_CONFIG_PROVIDER_NAMES = ['openai', 'openrouter'] as const;

/** Campos que forman parte del contrato configurable de chat en un perfil. */
export const AGENT_PROFILE_CHAT_CONFIG_FIELDS = [
  'contextTokenBudget', 'maxContextMessages', 'maxOutputTokens', 'reserveOutputTokens',
  'contextSafetyTokens', 'maxToolSteps', 'llmTraceRequests', 'summariesEnabled', 'summaryTokenBudget',
] as const;

/** Campos enteros de perfil que deben ser mayores que cero y respetar el límite máximo. */
export const AGENT_PROFILE_POSITIVE_INTEGER_FIELDS = [
  'contextTokenBudget', 'maxContextMessages', 'maxOutputTokens', 'reserveOutputTokens',
  'contextSafetyTokens', 'maxToolSteps', 'summaryTokenBudget',
] as const;

/** Defaults y límites seguros para los parámetros configurables por perfil de Realtime. */
export const AGENT_PROFILE_REALTIME_DEFAULT_MAX_CONTEXT_MESSAGES = 12;
export const AGENT_PROFILE_REALTIME_DEFAULT_MAX_INSTRUCTIONS_CHARACTERS = 24_000;
export const AGENT_PROFILE_REALTIME_DEFAULT_MAX_MESSAGE_CHARACTERS = 4_000;
export const AGENT_PROFILE_REALTIME_DEFAULT_MAX_TOOL_RESULT_CHARACTERS = 2_000;
export const AGENT_PROFILE_REALTIME_DEFAULT_MAX_SUMMARY_CHARACTERS = 4_000;
export const AGENT_PROFILE_REALTIME_DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
export const AGENT_PROFILE_REALTIME_DEFAULT_VAD_THRESHOLD = 0.5;
export const AGENT_PROFILE_REALTIME_DEFAULT_VAD_PREFIX_PADDING_MS = 300;
export const AGENT_PROFILE_REALTIME_DEFAULT_VAD_SILENCE_DURATION_MS = 500;
export const AGENT_PROFILE_REALTIME_DEFAULT_VAD_CREATE_RESPONSE = true;
export const AGENT_PROFILE_REALTIME_DEFAULT_VAD_INTERRUPT_RESPONSE = true;
export const AGENT_PROFILE_REALTIME_MAX_CONTEXT_MESSAGES = 1_000;
export const AGENT_PROFILE_REALTIME_MAX_INSTRUCTIONS_CHARACTERS = 100_000;
export const AGENT_PROFILE_REALTIME_MAX_CONTENT_CHARACTERS = 100_000;
export const AGENT_PROFILE_REALTIME_MAX_OUTPUT_TOKENS = 4_096;
export const AGENT_PROFILE_REALTIME_MAX_VAD_PREFIX_PADDING_MS = 2_000;
export const AGENT_PROFILE_REALTIME_MAX_VAD_SILENCE_DURATION_MS = 5_000;

/** Campos numéricos globales que requieren un entero positivo en runtime.config. */
export const RUNTIME_CONFIG_POSITIVE_INTEGER_FIELDS = [
  'contextTokenBudget', 'maxContextMessages', 'maxOutputTokens', 'reserveOutputTokens',
  'contextSafetyTokens', 'maxToolSteps', 'summaryTokenBudget',
] as const;
