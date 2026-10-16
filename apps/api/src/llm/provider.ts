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

/** Metadatos públicos de un modelo habilitado en el runtime. */
export type ModelInfo = {
  /** `proveedor/modelo`, el valor que manda el cliente. */
  id: string;
  provider: AiProvider;
  providerLabel: string;
  model: string;
};

/** Modelo habilitado junto con su instancia del proveedor y ventana de contexto efectiva. */
export type ResolvedModel = ModelInfo & {
  languageModel: LanguageModel;
  /** Ventana total configurada; el límite común es fallback para modelos sin entrada explícita. */
  contextWindowTokens: number;
};

const cache = new Map<string, LanguageModel>();

/** Lista los modelos configurados en proveedores que tienen una clave real, en orden de `AI_PROVIDERS`. */
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

/**
 * Resuelve exclusivamente el modelo elegido por el perfil de agente.
 * @param id Identificador completo `proveedor/modelo`.
 * @param fallbackContextWindow Ventana alternativa para modelos sin valor específico.
 * @returns Modelo listo para usar o `null` si no está configurado/habilitado.
 */
export function resolveModel(id: string | null | undefined, fallbackContextWindow: number): ResolvedModel | null {
  const fullId = id?.trim() ?? '';
  const split = splitModelId(fullId);
  if (!split) {
    return null;
  }
  const provider = split.provider as AiProvider;
  const providerConfig = config.ai.providers[provider];
  if (!providerConfig || !providerConfig.models.includes(split.model)) {
    return null;
  }
  // Provider instances capture credentials; include the key in the cache key so hot credential
  // rotations cannot keep using a stale model instance. The key itself is never logged or exposed.
  const cacheKey = `${fullId}\u0000${providerConfig.apiKey}`;
  for (const key of cache.keys()) {
    if (key.startsWith(`${fullId}\u0000`) && key !== cacheKey) cache.delete(key);
  }
  let languageModel = cache.get(cacheKey);
  if (!languageModel) {
    languageModel = factories[provider](providerConfig.apiKey, split.model);
    cache.set(cacheKey, languageModel);
  }
  return {
    id: fullId,
    provider,
    providerLabel: providerLabels[provider],
    model: split.model,
    languageModel,
    contextWindowTokens:
      providerConfig.contextWindows[split.model] ?? fallbackContextWindow,
  };
}
