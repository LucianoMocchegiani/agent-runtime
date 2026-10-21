import type { ChatConfig } from '../config.js';

/** Modelo completo `proveedor/modelo` seleccionado, o `null` si embeddings está deshabilitado. */
export type EmbeddingConfig = { model: string } | null;
/** Selección de modelos específicos para cada capacidad de un perfil. */
export type AgentProfileModelConfig = { chat: string; realtime?: string };
/** Ajustes independientes de la sesión de voz Realtime. */
export type AgentProfileRealtimeConfig = {
  voice: string;
  /** Máximo de mensajes anteriores incluidos como contexto. */
  maxContextMessages: number;
  /** Límite total de caracteres de las instrucciones enviadas a Realtime. */
  maxInstructionsCharacters: number;
  /** Límite por mensaje de usuario/asistente incluido en el contexto. */
  maxMessageCharacters: number;
  /** Límite por resultado de herramienta incluido en el contexto. */
  maxToolResultCharacters: number;
  /** Límite de caracteres del resumen previo incluido en el contexto. */
  maxSummaryCharacters: number;
  /** Máximo de tokens que puede generar una respuesta Realtime. */
  maxOutputTokens: number;
  vad: {
    threshold: number;
    prefixPaddingMs: number;
    silenceDurationMs: number;
    createResponse: boolean;
    interruptResponse: boolean;
  };
};
/** Ajustes de generación y contexto que pertenecen al chat. */
export type AgentProfileChatConfig = Pick<ChatConfig, 'contextTokenBudget' | 'maxContextMessages' | 'maxOutputTokens' | 'reserveOutputTokens' | 'contextSafetyTokens' | 'maxToolSteps' | 'llmTraceRequests' | 'summariesEnabled' | 'summaryTokenBudget'>;
/** Configuración de perfil: prompt compartido más límites específicos de cada modalidad. */
export type AgentProfileConfig = {
  systemPrompt: string;
  chat: AgentProfileChatConfig;
  realtime?: AgentProfileRealtimeConfig;
};
/** Perfil persistido que fija modelos y parámetros de comportamiento para un hilo. */
export type AgentProfile = { id: string; name: string; model: AgentProfileModelConfig; config: AgentProfileConfig; createdAt: string; updatedAt: string };
/** Ajustes efectivos del runtime: infraestructura global y valores de chat heredados. */
export type RuntimeSettings = Pick<ChatConfig, 'ai' | 'mcpConfig' | 'authIntrospectUrl' | 'authMapping' | 'chatSystemPrompt' | 'contextTokenBudget' | 'maxContextMessages' | 'maxOutputTokens' | 'reserveOutputTokens' | 'contextSafetyTokens' | 'maxToolSteps' | 'llmTraceRequests' | 'summariesEnabled' | 'summaryTokenBudget'> & { embeddingConfig: EmbeddingConfig };

/** Entrada normalizada lista para crear o actualizar un perfil persistido. */
export type AgentProfileWrite = { name: string; model: AgentProfileModelConfig; config: AgentProfileConfig };
