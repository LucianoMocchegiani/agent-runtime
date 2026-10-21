import type { AgentProfileWrite } from './contracts.js';
import { config } from '../config.js';
import {
  AGENT_PROFILE_CHAT_CONFIG_FIELDS,
  AGENT_PROFILE_INTEGER_MAX,
  AGENT_PROFILE_NAME_MAX_LENGTH,
  AGENT_PROFILE_POSITIVE_INTEGER_FIELDS,
  AGENT_PROFILE_PROMPT_MAX_LENGTH,
  AGENT_PROFILE_REALTIME_DEFAULT_MAX_CONTEXT_MESSAGES,
  AGENT_PROFILE_REALTIME_DEFAULT_MAX_INSTRUCTIONS_CHARACTERS,
  AGENT_PROFILE_REALTIME_DEFAULT_MAX_MESSAGE_CHARACTERS,
  AGENT_PROFILE_REALTIME_DEFAULT_MAX_TOOL_RESULT_CHARACTERS,
  AGENT_PROFILE_REALTIME_DEFAULT_MAX_SUMMARY_CHARACTERS,
  AGENT_PROFILE_REALTIME_DEFAULT_MAX_OUTPUT_TOKENS,
  AGENT_PROFILE_REALTIME_DEFAULT_VAD_THRESHOLD,
  AGENT_PROFILE_REALTIME_DEFAULT_VAD_PREFIX_PADDING_MS,
  AGENT_PROFILE_REALTIME_DEFAULT_VAD_SILENCE_DURATION_MS,
  AGENT_PROFILE_REALTIME_DEFAULT_VAD_CREATE_RESPONSE,
  AGENT_PROFILE_REALTIME_DEFAULT_VAD_INTERRUPT_RESPONSE,
  AGENT_PROFILE_REALTIME_MAX_CONTEXT_MESSAGES,
  AGENT_PROFILE_REALTIME_MAX_INSTRUCTIONS_CHARACTERS,
  AGENT_PROFILE_REALTIME_MAX_CONTENT_CHARACTERS,
  AGENT_PROFILE_REALTIME_MAX_OUTPUT_TOKENS,
  AGENT_PROFILE_REALTIME_MAX_VAD_PREFIX_PADDING_MS,
  AGENT_PROFILE_REALTIME_MAX_VAD_SILENCE_DURATION_MS,
} from './constants.js';

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Valida y normaliza los campos configurables de un perfil de agente. */
export function validateAgentProfileInput(name: unknown, rawModel: unknown, rawConfig: unknown): AgentProfileWrite {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > AGENT_PROFILE_NAME_MAX_LENGTH) {
    throw new Error(`name debe tener entre 1 y ${AGENT_PROFILE_NAME_MAX_LENGTH} caracteres`);
  }
  if (!record(rawModel)) throw new Error('model debe ser un objeto');
  const unsupportedModelFields = Object.keys(rawModel).filter((field) => !['chat', 'realtime'].includes(field));
  if (unsupportedModelFields.length) throw new Error(`model contiene campos no admitidos: ${unsupportedModelFields.join(', ')}`);
  if (typeof rawModel.chat !== 'string') throw new Error('model.chat debe ser un string');
  const chatModel = rawModel.chat.trim();
  if (!chatModel) throw new Error('model.chat es obligatorio');
  const slash = chatModel.indexOf('/');
  const provider = slash > 0 ? config.ai.providers[chatModel.slice(0, slash) as keyof typeof config.ai.providers] : undefined;
  if (!provider?.models.chat.includes(chatModel.slice(slash + 1))) {
    throw new Error('El modelo de chat no está habilitado en la configuración del runtime');
  }
  let realtimeModel: string | undefined;
  if (Object.hasOwn(rawModel, 'realtime')) {
    if (typeof rawModel.realtime !== 'string' || !rawModel.realtime.trim()) throw new Error('model.realtime debe ser un string no vacío');
    realtimeModel = rawModel.realtime.trim();
    if (!config.ai.providers.openai?.models.realtime?.includes(realtimeModel)) {
      throw new Error('El modelo Realtime no está habilitado en la configuración del runtime');
    }
  }

  if (!record(rawConfig)) throw new Error('config debe ser un objeto');
  const unsupportedConfigFields = Object.keys(rawConfig).filter((field) => !['systemPrompt', 'chat', 'realtime'].includes(field));
  if (unsupportedConfigFields.length) throw new Error(`config contiene campos no admitidos: ${unsupportedConfigFields.join(', ')}`);
  if (typeof rawConfig.systemPrompt !== 'string' || rawConfig.systemPrompt.length > AGENT_PROFILE_PROMPT_MAX_LENGTH) {
    throw new Error(`config.systemPrompt debe ser un string de hasta ${AGENT_PROFILE_PROMPT_MAX_LENGTH} caracteres`);
  }

  if (!record(rawConfig.chat)) throw new Error('config.chat debe ser un objeto');
  const chat = rawConfig.chat;
  const unsupportedChatFields = Object.keys(chat).filter((field) => !(AGENT_PROFILE_CHAT_CONFIG_FIELDS as readonly string[]).includes(field));
  if (unsupportedChatFields.length) throw new Error(`config.chat contiene campos no admitidos: ${unsupportedChatFields.join(', ')}`);
  for (const field of AGENT_PROFILE_CHAT_CONFIG_FIELDS) {
    if (!Object.hasOwn(chat, field)) throw new Error(`Falta ${field} en config.chat`);
  }
  for (const field of AGENT_PROFILE_POSITIVE_INTEGER_FIELDS) {
    const value = chat[field];
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > AGENT_PROFILE_INTEGER_MAX) {
      throw new Error(`config.chat.${field} debe ser un entero positivo`);
    }
  }
  if ((chat.reserveOutputTokens as number) < (chat.maxOutputTokens as number)) {
    throw new Error('config.chat.reserveOutputTokens debe ser mayor o igual que config.chat.maxOutputTokens');
  }
  if (typeof chat.llmTraceRequests !== 'boolean' || typeof chat.summariesEnabled !== 'boolean') {
    throw new Error('Configuración de chat inválida');
  }

  let realtimeConfig: AgentProfileWrite['config']['realtime'];
  if (Object.hasOwn(rawConfig, 'realtime')) {
    if (!record(rawConfig.realtime)) throw new Error('config.realtime debe definir voice');
    const realtime = rawConfig.realtime;
    const supportedRealtimeFields = [
      'voice', 'maxContextMessages', 'maxInstructionsCharacters', 'maxMessageCharacters',
      'maxToolResultCharacters', 'maxSummaryCharacters', 'maxOutputTokens', 'vad',
    ];
    const unsupportedRealtimeFields = Object.keys(realtime).filter((field) => !supportedRealtimeFields.includes(field));
    if (unsupportedRealtimeFields.length) throw new Error(`config.realtime contiene campos no admitidos: ${unsupportedRealtimeFields.join(', ')}`);
    if (typeof realtime.voice !== 'string' || !realtime.voice.trim()) throw new Error('config.realtime debe definir voice');
    if (!realtimeModel) throw new Error('model.realtime es obligatorio cuando config.realtime está habilitado');
    const providerRealtime = config.ai.providers.openai?.realtime;
    const selectedVoice = realtime.voice.trim();
    if (!providerRealtime?.voices.includes(selectedVoice)) {
      throw new Error('La voz del perfil debe estar habilitada en Provider');
    }
    const maxContextMessages = realtime.maxContextMessages ?? AGENT_PROFILE_REALTIME_DEFAULT_MAX_CONTEXT_MESSAGES;
    const maxInstructionsCharacters = realtime.maxInstructionsCharacters ?? AGENT_PROFILE_REALTIME_DEFAULT_MAX_INSTRUCTIONS_CHARACTERS;
    const maxMessageCharacters = realtime.maxMessageCharacters ?? AGENT_PROFILE_REALTIME_DEFAULT_MAX_MESSAGE_CHARACTERS;
    const maxToolResultCharacters = realtime.maxToolResultCharacters ?? AGENT_PROFILE_REALTIME_DEFAULT_MAX_TOOL_RESULT_CHARACTERS;
    const maxSummaryCharacters = realtime.maxSummaryCharacters ?? AGENT_PROFILE_REALTIME_DEFAULT_MAX_SUMMARY_CHARACTERS;
    const maxOutputTokens = realtime.maxOutputTokens ?? AGENT_PROFILE_REALTIME_DEFAULT_MAX_OUTPUT_TOKENS;
    const boundedIntegers: Array<[string, unknown, number]> = [
      ['maxContextMessages', maxContextMessages, AGENT_PROFILE_REALTIME_MAX_CONTEXT_MESSAGES],
      ['maxInstructionsCharacters', maxInstructionsCharacters, AGENT_PROFILE_REALTIME_MAX_INSTRUCTIONS_CHARACTERS],
      ['maxMessageCharacters', maxMessageCharacters, AGENT_PROFILE_REALTIME_MAX_CONTENT_CHARACTERS],
      ['maxToolResultCharacters', maxToolResultCharacters, AGENT_PROFILE_REALTIME_MAX_CONTENT_CHARACTERS],
      ['maxSummaryCharacters', maxSummaryCharacters, AGENT_PROFILE_REALTIME_MAX_CONTENT_CHARACTERS],
      ['maxOutputTokens', maxOutputTokens, AGENT_PROFILE_REALTIME_MAX_OUTPUT_TOKENS],
    ];
    for (const [field, value, maximum] of boundedIntegers) {
      if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
        throw new Error(`config.realtime.${field} debe ser un entero entre 1 y ${maximum}`);
      }
    }
    const rawVad = realtime.vad ?? {};
    if (!record(rawVad)) throw new Error('config.realtime.vad debe ser un objeto');
    const unsupportedVadFields = Object.keys(rawVad).filter((field) => ![
      'threshold', 'prefixPaddingMs', 'silenceDurationMs', 'createResponse', 'interruptResponse',
    ].includes(field));
    if (unsupportedVadFields.length) throw new Error(`config.realtime.vad contiene campos no admitidos: ${unsupportedVadFields.join(', ')}`);
    const vad = {
      threshold: rawVad.threshold ?? AGENT_PROFILE_REALTIME_DEFAULT_VAD_THRESHOLD,
      prefixPaddingMs: rawVad.prefixPaddingMs ?? AGENT_PROFILE_REALTIME_DEFAULT_VAD_PREFIX_PADDING_MS,
      silenceDurationMs: rawVad.silenceDurationMs ?? AGENT_PROFILE_REALTIME_DEFAULT_VAD_SILENCE_DURATION_MS,
      createResponse: rawVad.createResponse ?? AGENT_PROFILE_REALTIME_DEFAULT_VAD_CREATE_RESPONSE,
      interruptResponse: rawVad.interruptResponse ?? AGENT_PROFILE_REALTIME_DEFAULT_VAD_INTERRUPT_RESPONSE,
    };
    if (typeof vad.threshold !== 'number' || !Number.isFinite(vad.threshold) || vad.threshold < 0 || vad.threshold > 1) {
      throw new Error('config.realtime.vad.threshold debe ser un número entre 0 y 1');
    }
    if (!Number.isSafeInteger(vad.prefixPaddingMs) || (vad.prefixPaddingMs as number) < 0
      || (vad.prefixPaddingMs as number) > AGENT_PROFILE_REALTIME_MAX_VAD_PREFIX_PADDING_MS) {
      throw new Error(`config.realtime.vad.prefixPaddingMs debe ser un entero entre 0 y ${AGENT_PROFILE_REALTIME_MAX_VAD_PREFIX_PADDING_MS}`);
    }
    if (!Number.isSafeInteger(vad.silenceDurationMs) || (vad.silenceDurationMs as number) < 100
      || (vad.silenceDurationMs as number) > AGENT_PROFILE_REALTIME_MAX_VAD_SILENCE_DURATION_MS) {
      throw new Error(`config.realtime.vad.silenceDurationMs debe ser un entero entre 100 y ${AGENT_PROFILE_REALTIME_MAX_VAD_SILENCE_DURATION_MS}`);
    }
    if (typeof vad.createResponse !== 'boolean' || typeof vad.interruptResponse !== 'boolean') {
      throw new Error('config.realtime.vad.createResponse e interruptResponse deben ser booleanos');
    }
    realtimeConfig = {
      voice: selectedVoice,
      maxContextMessages: maxContextMessages as number,
      maxInstructionsCharacters: maxInstructionsCharacters as number,
      maxMessageCharacters: maxMessageCharacters as number,
      maxToolResultCharacters: maxToolResultCharacters as number,
      maxSummaryCharacters: maxSummaryCharacters as number,
      maxOutputTokens: maxOutputTokens as number,
      vad: vad as NonNullable<AgentProfileWrite['config']['realtime']>['vad'],
    };
  }

  return {
    name: name.trim(),
    model: { chat: chatModel, ...(realtimeModel ? { realtime: realtimeModel } : {}) },
    config: {
      systemPrompt: rawConfig.systemPrompt,
      chat: Object.fromEntries(AGENT_PROFILE_CHAT_CONFIG_FIELDS.map((field) => [field, chat[field]])) as AgentProfileWrite['config']['chat'],
      ...(realtimeConfig ? { realtime: realtimeConfig } : {}),
    },
  };
}
