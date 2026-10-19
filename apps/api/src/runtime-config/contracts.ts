import type { ChatConfig } from '../config.js';

/** Credenciales y modelo del proveedor de embeddings, o `null` si está deshabilitado. */
export type EmbeddingConfig = { apiKey: string; baseUrl: string; model: string } | null;
/** Ajustes de conversación que pertenecen a un perfil de agente. */
export type AgentProfileConfig = Pick<ChatConfig, 'chatSystemPrompt' | 'contextTokenBudget' | 'maxContextMessages' | 'maxOutputTokens' | 'reserveOutputTokens' | 'contextSafetyTokens' | 'maxToolSteps' | 'llmTraceRequests' | 'summariesEnabled' | 'summaryTokenBudget'>;
/** Perfil persistido que fija modelo y parámetros de comportamiento para un hilo. */
export type AgentProfile = { id: string; name: string; modelId: string; config: AgentProfileConfig; createdAt: string; updatedAt: string };
/** Ajustes efectivos del runtime: infraestructura global y valores de chat heredados. */
export type RuntimeSettings = Pick<ChatConfig, 'ai' | 'mcpConfig' | 'authIntrospectUrl' | 'authMapping' | 'chatSystemPrompt' | 'contextTokenBudget' | 'maxContextMessages' | 'maxOutputTokens' | 'reserveOutputTokens' | 'contextSafetyTokens' | 'maxToolSteps' | 'llmTraceRequests' | 'summariesEnabled' | 'summaryTokenBudget'> & { embeddingConfig: EmbeddingConfig };

/** Entrada normalizada lista para crear o actualizar un perfil persistido. */
export type AgentProfileWrite = { name: string; modelId: string; config: AgentProfileConfig };
