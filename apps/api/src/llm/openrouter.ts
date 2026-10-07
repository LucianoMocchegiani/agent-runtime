import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';

/** Modelo vía OpenRouter (slug, ej. `openai/gpt-4.1-mini`). */
export function openrouterChatModel(apiKey: string, model: string): LanguageModel {
  const openrouter = createOpenRouter({
    apiKey,
    compatibility: 'strict',
  });
  return openrouter(model);
}
