import type { LanguageModel } from 'ai';
import { AI_PROVIDERS, config, splitModelId, type AiProvider } from '../config.js';
import { openaiChatModel } from './openai.js';
import { openrouterChatModel } from './openrouter.js';

const factories: Record<AiProvider, (apiKey: string, model: string) => LanguageModel> = {
  openrouter: openrouterChatModel,
  openai: openaiChatModel,
};

const providerLabels: Record<AiProvider, string> = {
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
};

export type ModelInfo = {
  /** `proveedor/modelo`, el valor que manda el cliente. */
  id: string;
  provider: AiProvider;
  providerLabel: string;
  model: string;
};

export type ResolvedModel = ModelInfo & {
  languageModel: LanguageModel;
  /** Ventana total configurada; el límite común es fallback para modelos sin entrada explícita. */
  contextWindowTokens: number;
};

const cache = new Map<string, LanguageModel>();

/** Modelos habilitados (proveedores con apiKey real), en el orden de `AI_PROVIDERS`. */
export function listModels(): ModelInfo[] {
  return AI_PROVIDERS.flatMap((provider) =>
    (config.ai.providers[provider]?.models ?? []).map((model) => ({
      id: `${provider}/${model}`,
      provider,
      providerLabel: providerLabels[provider],
      model,
    })),
  );
}

export function defaultModelId(): string {
  return config.ai.defaultModel;
}

/**
 * `proveedor/modelo` → modelo listo para `streamText`. Sin id usa el default.
 *
 * @returns null si el proveedor no está habilitado o el modelo no está en su lista.
 */
export function resolveModel(id?: string | null): ResolvedModel | null {
  const fullId = id?.trim() || config.ai.defaultModel;
  const split = splitModelId(fullId);
  if (!split) {
    return null;
  }
  const provider = split.provider as AiProvider;
  const providerConfig = config.ai.providers[provider];
  if (!providerConfig || !providerConfig.models.includes(split.model)) {
    return null;
  }
  let languageModel = cache.get(fullId);
  if (!languageModel) {
    languageModel = factories[provider](providerConfig.apiKey, split.model);
    cache.set(fullId, languageModel);
  }
  return {
    id: fullId,
    provider,
    providerLabel: providerLabels[provider],
    model: split.model,
    languageModel,
    contextWindowTokens:
      providerConfig.contextWindows[split.model] ?? config.contextTokenBudget,
  };
}
