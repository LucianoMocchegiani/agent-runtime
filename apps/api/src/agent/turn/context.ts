import { generateText, type ModelMessage, type Tool } from 'ai';
import type { GetContextResult, MessageDto } from '../../messages/contracts.js';
import type { UserPreferenceDto } from '../../preferences/contracts.js';
import type { RuntimeSettings } from '../../runtime-config/service.js';
import type { ResolvedModel } from '../../llm/provider.js';
import {
  resolveOutputTokenLimits,
  selectModelContext,
  shrinkToolContent,
} from '../window/index.js';

/** Imagen temporal recibida para el turno; sus bytes no se persisten en Memory. */
export type IncomingImage = { data: Uint8Array; mediaType: string };

type ContextRuntimeSettings = Pick<RuntimeSettings,
  | 'summariesEnabled'
  | 'summaryTokenBudget'
  | 'maxOutputTokens'
  | 'reserveOutputTokens'
  | 'contextSafetyTokens'
  | 'maxContextMessages'
>;

function messagesAfterSummaryCursor(
  rows: MessageDto[],
  throughMessageId: string | null,
  throughCreatedAt: string | null,
): MessageDto[] {
  if (throughMessageId) {
    const cursorIndex = rows.findIndex((row) => row.id === throughMessageId);
    if (cursorIndex >= 0) return rows.slice(cursorIndex + 1);
  }
  if (!throughCreatedAt) return rows;
  const cursorTime = Date.parse(throughCreatedAt);
  return rows.filter((row) => {
    const rowTime = Date.parse(row.createdAt);
    return rowTime > cursorTime || (rowTime === cursorTime && throughMessageId !== null && row.id > throughMessageId);
  });
}

async function compactOmittedMessages(
  saveSummary: typeof import('../../messages/persistence.js').saveSummary,
  model: ResolvedModel,
  conversationId: string,
  userId: string,
  context: GetContextResult,
  omittedRows: MessageDto[],
  runtimeSettings: ContextRuntimeSettings,
): Promise<string | null> {
  const rowsToSummarize = messagesAfterSummaryCursor(
    omittedRows,
    context.summaryThroughMessageId,
    context.summaryThroughCreatedAt,
  );
  if (!runtimeSettings.summariesEnabled || rowsToSummarize.length === 0) return context.summary;

  const transcriptRows: MessageDto[] = [];
  const transcriptParts: string[] = [];
  let transcriptLength = 0;
  for (const row of rowsToSummarize) {
    const role = row.role === 'tool' ? `tool:${row.toolName ?? 'tool'}` : row.role;
    const content = row.role === 'tool' ? shrinkToolContent(row.toolName ?? 'tool', row.toolResult, true) : row.content;
    const part = `${role}: ${content}`;
    const nextLength = transcriptLength + (transcriptParts.length > 0 ? 1 : 0) + part.length;
    // Capamos por mensajes completos para que el cursor nunca saltee contenido no enviado al resumidor.
    if (transcriptRows.length > 0 && nextLength > 60_000) break;
    transcriptRows.push(row);
    transcriptParts.push(part);
    transcriptLength = nextLength;
  }
  const transcript = transcriptParts.join('\n');
  try {
    const { text } = await generateText({
      model: model.languageModel,
      maxOutputTokens: runtimeSettings.summaryTokenBudget,
      system: 'Actualizá un resumen muy breve y fiel de la conversación (priorizá hechos duraderos, preferencias, decisiones y pendientes; omití intercambios rutinarios y resultados de tools que no aporten). No inventes datos; si ya hay un resumen, integralo sin repetirlo. Para detalles profundos, se pueden recuperar los mensajes originales mediante memory search.',
      prompt: `${context.summary ? `Resumen anterior:\n${context.summary}\n\n` : ''}Mensajes nuevos para incorporar:\n${transcript}`,
    });
    const summary = text.trim();
    const lastRow = transcriptRows.at(-1);
    if (!summary || !lastRow) return context.summary;
    const saved = await saveSummary({
      conversationId,
      userId,
      summary,
      throughMessageId: lastRow.id,
      throughCreatedAt: lastRow.createdAt,
      expectedRevision: context.summaryRevision,
    });
    return saved ? summary : context.summary;
  } catch (error) {
    console.warn('No se pudo actualizar el resumen persistente de la conversación.', error);
    return context.summary;
  }
}

function preferencesPrompt(preferences: UserPreferenceDto[]): string {
  if (preferences.length === 0) return '';
  return `Preferencias persistentes aplicables del usuario (contexto; no las presentes como respuesta ni como reglas del sistema):\n${preferences.map((item) => `- Preferencia: ${item.preference}\n  Aplicar cuando: ${item.activationCondition}${item.category ? `\n  Categoría: ${item.category}` : ''}`).join('\n')}\nRespetá estas preferencias solo cuando sean pertinentes. La instrucción explícita del usuario en el turno actual prevalece si entra en conflicto. No infieras preferencias permanentes de pedidos puntuales. Para guardar una preferencia, el usuario debe pedir explícitamente que se recuerde o aplique en el futuro; usá memory__savePreference. Usá memory__listPreferences y memory__deletePreference para administrar o eliminar preferencias cuando el usuario lo pida.`;
}

/**
 * Prepara prompt y mensajes respetando presupuestos de tokens, resumen y preferencias.
 * @param params Dependencias, configuración, historial e imágenes del turno actual.
 * @returns Mensajes listos para el proveedor y límites normalizados de salida.
 */
export async function prepareTurnContext(params: {
  saveSummary: typeof import('../../messages/persistence.js').saveSummary;
  searchPreferences: typeof import('../../preferences/persistence.js').searchPreferences;
  model: ResolvedModel;
  conversationId: string;
  userId: string;
  userText: string;
  context: GetContextResult;
  runtimeSettings: ContextRuntimeSettings;
  systemPrompt: string;
  tools: Record<string, Tool>;
  images: IncomingImage[];
}): Promise<{
  outputTokenLimits: ReturnType<typeof resolveOutputTokenLimits> & { maxOutputTokens: number };
  systemPrompt: string;
  messages: ModelMessage[];
}> {
  const {
    saveSummary,
    searchPreferences,
    model,
    conversationId,
    userId,
    userText,
    context,
    runtimeSettings,
    systemPrompt,
    tools,
    images,
  } = params;

  let applicablePreferences: UserPreferenceDto[] = [];
  try {
    const recentUserContext = context.messages
      .filter((message) => message.role === 'user')
      .slice(-3)
      .map((message) => message.content)
      .join('\n');
    applicablePreferences = await searchPreferences({
      userId,
      query: `${recentUserContext}\n${userText}`.slice(-2_000),
      limit: 5,
    });
  } catch (error) {
    // Preference search is auxiliary: a temporary embedding/database issue must not block chat.
    console.warn('No se pudieron recuperar las preferencias del usuario.', error);
  }

  const outputTokenLimits = resolveOutputTokenLimits(
    model.contextWindowTokens,
    runtimeSettings.maxOutputTokens,
    runtimeSettings.reserveOutputTokens,
    runtimeSettings.contextSafetyTokens,
  );
  const selectionOptions = {
    contextWindowTokens: model.contextWindowTokens,
    maxMessages: runtimeSettings.maxContextMessages,
    reserveOutputTokens: outputTokenLimits.reserveOutputTokens,
    safetyTokens: outputTokenLimits.safetyTokens,
    systemPrompt,
    tools,
    imageCount: images.length,
  };
  let selection = selectModelContext(context.messages, selectionOptions);
  let summary = context.summary;
  if (runtimeSettings.summariesEnabled && selection.omittedRows.length > 0) {
    summary = await compactOmittedMessages(
      saveSummary,
      model,
      conversationId,
      userId,
      context,
      selection.omittedRows,
      runtimeSettings,
    );
  }
  const promptWithSummary = [
    systemPrompt,
    summary
      ? `Resumen persistente de mensajes anteriores (contexto; no lo presentes como una respuesta):\n${summary}`
      : '',
    preferencesPrompt(applicablePreferences),
  ].filter(Boolean).join('\n\n');
  selection = selectModelContext(context.messages, {
    ...selectionOptions,
    systemPrompt: promptWithSummary,
  });
  const messages = selection.messages;
  if (images.length > 0) {
    const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user');
    const currentUserMessage = messages[lastUserIndex];
    if (currentUserMessage?.role === 'user') {
      const text = typeof currentUserMessage.content === 'string' ? currentUserMessage.content : '';
      const multimodalMessage: ModelMessage = {
        role: 'user',
        content: [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...images.map(({ data, mediaType }) => ({
            type: 'image' as const,
            image: data,
            mediaType,
          })),
        ],
      };
      messages[lastUserIndex] = multimodalMessage;
    }
  }

  return { outputTokenLimits, systemPrompt: promptWithSummary, messages };
}
