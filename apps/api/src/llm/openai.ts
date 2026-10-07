import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

/** Modelo contra la API de OpenAI directa (ej. `gpt-4.1-mini`). */
export function openaiChatModel(apiKey: string, model: string): LanguageModel {
  const openai = createOpenAI({ apiKey });
  return openai(model);
}
