import type { AgentProfileWrite } from './contracts.js';
import { config } from '../config.js';
import {
  AGENT_PROFILE_CONFIG_FIELDS,
  AGENT_PROFILE_INTEGER_MAX,
  AGENT_PROFILE_NAME_MAX_LENGTH,
  AGENT_PROFILE_POSITIVE_INTEGER_FIELDS,
  AGENT_PROFILE_PROMPT_MAX_LENGTH,
} from './constants.js';

/** Valida y normaliza los campos configurables de un perfil de agente. */
export function validateAgentProfileInput(name: unknown, modelId: unknown, rawConfig: unknown): AgentProfileWrite {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > AGENT_PROFILE_NAME_MAX_LENGTH) {
    throw new Error(`name debe tener entre 1 y ${AGENT_PROFILE_NAME_MAX_LENGTH} caracteres`);
  }
  if (typeof modelId !== 'string') throw new Error('modelId debe ser un string');
  const normalizedModelId = modelId.trim();
  if (normalizedModelId) {
    const slash = normalizedModelId.indexOf('/');
    const provider = slash > 0 ? config.ai.providers[normalizedModelId.slice(0, slash) as keyof typeof config.ai.providers] : undefined;
    if (!provider?.models.includes(normalizedModelId.slice(slash + 1))) {
      throw new Error('El modelo no está habilitado en la configuración del runtime');
    }
  }
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) throw new Error('config debe ser un objeto');
  const candidate = rawConfig as Record<string, unknown>;
  for (const field of AGENT_PROFILE_CONFIG_FIELDS) {
    if (!Object.hasOwn(candidate, field)) throw new Error(`Falta ${field} en config`);
  }
  for (const field of AGENT_PROFILE_POSITIVE_INTEGER_FIELDS) {
    const value = candidate[field];
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > AGENT_PROFILE_INTEGER_MAX) {
      throw new Error(`${field} debe ser un entero positivo`);
    }
  }
  if ((candidate.reserveOutputTokens as number) < (candidate.maxOutputTokens as number)) {
    throw new Error('reserveOutputTokens debe ser mayor o igual que maxOutputTokens');
  }
  if (typeof candidate.chatSystemPrompt !== 'string' || candidate.chatSystemPrompt.length > AGENT_PROFILE_PROMPT_MAX_LENGTH
    || typeof candidate.llmTraceRequests !== 'boolean' || typeof candidate.summariesEnabled !== 'boolean') {
    throw new Error('Configuración de agente inválida');
  }
  let voice: AgentProfileWrite['config']['voice'];
  if (Object.hasOwn(candidate, 'voice')) {
    const rawVoice = candidate.voice;
    if (!rawVoice || typeof rawVoice !== 'object' || Array.isArray(rawVoice)) {
      throw new Error('config.voice debe definir transcriptionModel, speechModel, speechVoice y language');
    }
    const value = rawVoice as Record<string, unknown>;
    if (typeof value.transcriptionModel !== 'string' || !value.transcriptionModel.trim()
      || typeof value.speechModel !== 'string' || !value.speechModel.trim()
      || typeof value.speechVoice !== 'string' || !value.speechVoice.trim()
      || typeof value.language !== 'string' || !value.language.trim()) {
      throw new Error('config.voice debe definir transcriptionModel, speechModel, speechVoice y language');
    }
    const providerVoice = config.ai.providers.openai?.voice;
    if (!providerVoice) throw new Error('Configurá primero las capacidades de voz del proveedor OpenAI');
    if (!providerVoice.transcriptionModels.includes(value.transcriptionModel.trim())
      || !providerVoice.speechModels.includes(value.speechModel.trim())
      || !providerVoice.speechVoices.includes(value.speechVoice.trim())) {
      throw new Error('La configuración de voz del perfil debe elegir modelos y voz habilitados en Provider');
    }
    voice = {
      transcriptionModel: value.transcriptionModel.trim(),
      speechModel: value.speechModel.trim(),
      speechVoice: value.speechVoice.trim(),
      language: value.language.trim(),
    };
  }
  return {
    name: name.trim(),
    modelId: normalizedModelId,
    config: {
      ...Object.fromEntries(AGENT_PROFILE_CONFIG_FIELDS.map((field) => [field, candidate[field]])),
      ...(voice ? { voice } : {}),
    } as AgentProfileWrite['config'],
  };
}
