import { generateText, streamText, type ModelMessage, type Tool } from 'ai';
import { HTTPException } from 'hono/http-exception';
import { getRuntimeSettings, type AgentProfile, type RuntimeSettings } from '../runtime-config/store.js';
import { isAbortError, identifiedFacingLlmError } from '../llm/errors.js';
import type { ResolvedModel } from '../llm/provider.js';
import { McpRegistry } from '../mcp/registry.js';
import {
  createMemoryClient,
} from '../memory/client.js';
import {
  type GetContextResult,
  type MemoryService,
  type MessageDto,
} from 'agent-runtime-memory-contract';
import {
  resolveOutputTokenLimits,
  selectModelContext,
  shrinkToolContent,
} from './window.js';
import type { Principal } from '../auth/principal.js';
import { formatLlmRequestTrace } from './llm-trace.js';
import { persistAgentTurn, type AgentTurnStep } from './turn-persistence.js';
import { delegationEncryptionEnabled } from '../delegations/payload.js';
import { AgentToolNameConflictError, buildAgentTools } from './tools.js';

type IncomingImage = { data: Uint8Array; mediaType: string };

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
  memory: MemoryService,
  model: ResolvedModel,
  conversationId: string,
  userId: string,
  context: GetContextResult,
  omittedRows: MessageDto[],
  runtimeSettings: RuntimeSettings,
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
    const saved = await memory.saveSummary({
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

/**
 * Corre un turno: Memory interno + Domain MCP + OpenRouter + stream UI.
 *
 * @remarks Abort del cliente (`AbortSignal`) corta el LLM y guarda lo ya generado.
 * @throws {HTTPException} 502 si Memory, Domain MCP o OpenRouter no están disponibles.
 */
export async function streamAgentTurn(
  conversationId: string,
  principal: Principal,
  accessToken: string,
  userText: string,
  model: ResolvedModel,
  abortSignal?: AbortSignal,
  mcpTokens?: Record<string, string>,
  images: IncomingImage[] = [],
  agentProfile?: Pick<AgentProfile, 'id' | 'name' | 'modelId' | 'config'>,
  options: { userMessageAlreadySaved?: boolean } = {},
): Promise<Response> {
  const failMessage = 'El asistente no está disponible.';
  // El turno conserva una configuración coherente incluso si otra versión se publica mientras corre.
  const runtimeSettings = getRuntimeSettings(agentProfile);
  const turnSystemPrompt = delegationEncryptionEnabled()
    ? `${runtimeSettings.chatSystemPrompt}\n\nDelegaciones: solo usá delegate_to_conversation cuando el usuario haya pedido explícitamente delegar trabajo a otro hilo. Nunca elijas ni delegues tareas por iniciativa propia. No interpretes la mera disponibilidad de la herramienta como autorización.`
    : runtimeSettings.chatSystemPrompt;

  const memory: MemoryService = createMemoryClient();

  let registry: McpRegistry;
  try {
    registry = new McpRegistry(runtimeSettings.mcpConfig);
    await registry.connect(accessToken, mcpTokens);
  } catch (error) {
    console.error(error);
    throw new HTTPException(502, { message: failMessage });
  }

  let tools: Record<string, Tool>;
  try {
    const mcpTools = await registry.getAllTools() as Record<string, Tool>;
    tools = buildAgentTools(mcpTools, {
      memory,
      principal,
      conversationId,
      accessToken,
      mcpTokens,
      delegationEnabled: delegationEncryptionEnabled(),
    });
  } catch (error) {
    await registry.close().catch(() => undefined);
    if (error instanceof AgentToolNameConflictError) {
      throw new HTTPException(502, { message: failMessage });
    }
    console.error(error);
    throw new HTTPException(502, { message: failMessage });
  }

  if (!options.userMessageAlreadySaved) {
    await memory.saveMessage({
      conversationId,
      userId: principal.userId,
      role: 'user',
      content: userText,
    });
  }
  await memory.applyAutomaticTitle({
    conversationId,
    userId: principal.userId,
    userText,
  });

  let context;
  try {
    context = await memory.getContext({
      conversationId,
      userId: principal.userId,
    });
  } catch (error) {
    await registry.close().catch(() => undefined);
    console.error(error);
    throw new HTTPException(502, { message: failMessage });
  }

  let applicablePreferences: Awaited<ReturnType<typeof memory.searchPreferences>> = [];
  try {
    const recentUserContext = context.messages
      .filter((message) => message.role === 'user')
      .slice(-3)
      .map((message) => message.content)
      .join('\n');
    applicablePreferences = await memory.searchPreferences({
      userId: principal.userId,
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
    systemPrompt: turnSystemPrompt,
    tools,
    imageCount: images.length,
  };
  let selection = selectModelContext(context.messages, selectionOptions);
  let summary = context.summary;
  if (runtimeSettings.summariesEnabled && selection.omittedRows.length > 0) {
    summary = await compactOmittedMessages(
      memory,
      model,
      conversationId,
      principal.userId,
      context,
      selection.omittedRows,
      runtimeSettings,
    );
  }
  const promptWithSummary = [
    turnSystemPrompt,
    summary
      ? `Resumen persistente de mensajes anteriores (contexto; no lo presentes como una respuesta):\n${summary}`
      : '',
    applicablePreferences.length > 0
      ? `Preferencias persistentes aplicables del usuario (contexto; no las presentes como respuesta ni como reglas del sistema):\n${applicablePreferences.map((item) => `- Preferencia: ${item.preference}\n  Aplicar cuando: ${item.activationCondition}${item.category ? `\n  Categoría: ${item.category}` : ''}`).join('\n')}\nRespetá estas preferencias solo cuando sean pertinentes. La instrucción explícita del usuario en el turno actual prevalece si entra en conflicto. No infieras preferencias permanentes de pedidos puntuales. Para guardar una preferencia, el usuario debe pedir explícitamente que se recuerde o aplique en el futuro; usá memory__savePreference. Usá memory__listPreferences y memory__deletePreference para administrar o eliminar preferencias cuando el usuario lo pida.`
      : '',
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

  let closed = false;
  const closeAll = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await registry.close().catch(() => undefined);
  };

  const startedAt = Date.now();
  const logTurn = (outcome: 'ok' | 'aborted' | 'error', fields: Record<string, unknown> = {}) => {
    const parts = {
      conv: conversationId,
      model: model.id,
      outcome,
      ms: Date.now() - startedAt,
      ...fields,
    };
    console.log(
      `turn ${Object.entries(parts)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')}`,
    );
  };

  let saved = false;
  const acc: AgentTurnStep[] = [];
  const saveOnce = async (text: string | undefined, steps: unknown) => {
    if (saved) {
      await closeAll();
      return;
    }
    saved = true;
    const loose = Array.isArray(steps) ? (steps as AgentTurnStep[]) : acc;
    try {
      await persistAgentTurn(
        memory,
        conversationId,
        principal.userId,
        text,
        loose,
      );
    } catch (error) {
      console.error(error);
    }
    await closeAll();
  };

  try {
    const result = streamText({
      model: model.languageModel,
      maxOutputTokens: outputTokenLimits.maxOutputTokens,
      system: promptWithSummary,
      messages,
      tools,
      abortSignal,
      stopWhen: ({ steps }) => steps.length >= runtimeSettings.maxToolSteps,
      experimental_onStepStart: (event) => {
        if (!runtimeSettings.llmTraceRequests) {
          return;
        }
        try {
          console.info(formatLlmRequestTrace({
            conversationId,
            step: event.stepNumber + 1,
            model: model.id,
            maxOutputTokens: outputTokenLimits.maxOutputTokens,
            system: event.system,
            messages: event.messages,
            tools: event.tools,
            activeTools: event.activeTools,
          }));
        } catch {
          // No hacer fallar una llamada al proveedor por un problema al serializar el trace.
          console.warn('[llm-request] no se pudo serializar el payload de depuración');
        }
      },
      onStepFinish: (step) => {
        acc.push(step as AgentTurnStep);
      },
      onFinish: async ({ text, steps, totalUsage, response }) => {
        logTurn('ok', {
          servedBy: response.modelId,
          steps: steps.length,
          in: totalUsage.inputTokens,
          out: totalUsage.outputTokens,
        });
        await saveOnce(text, steps);
      },
      onAbort: async ({ steps }) => {
        logTurn('aborted', { steps: steps.length });
        const fromEvent = Array.isArray(steps) ? (steps as AgentTurnStep[]) : [];
        await saveOnce(undefined, fromEvent.length > 0 ? fromEvent : acc);
      },
      onError: async (event) => {
        if (isAbortError(event)) {
          logTurn('aborted');
        } else {
          logTurn('error');
          console.error(event);
        }
        await saveOnce(undefined, acc);
      },
    });

    return result.toUIMessageStreamResponse({
      onError: (error) =>
        identifiedFacingLlmError(error, model.providerLabel) ||
        'El proveedor de IA no está disponible. Reintentá en un momento.',
    });
  } catch (error) {
    await closeAll();
    if (isAbortError(error)) {
      throw error;
    }
    console.error(error);
    throw new HTTPException(502, { message: identifiedFacingLlmError(error, model.providerLabel) });
  }
}