import { streamText, type ModelMessage, type Tool } from 'ai';
import { HTTPException } from 'hono/http-exception';
import { saveMessage } from '../../messages/persistence.js';
import type { ResolvedModel } from '../../llm/provider.js';
import { isAbortError, identifiedFacingLlmError } from '../../llm/errors.js';
import type { McpRegistry } from '../../mcp/registry.js';
import type { RuntimeSettings } from '../../runtime-config/service.js';
import { formatLlmRequestTrace } from './llm-trace.js';
import { persistAgentTurn, type AgentTurnStep } from './persistence.js';

/** Ejecuta el stream del modelo y coordina persistencia y cierre de recursos del turno. */
export async function streamPreparedAgentTurn(params: {
  conversationId: string;
  userId: string;
  model: ResolvedModel;
  registry: Pick<McpRegistry, 'close'>;
  runtimeSettings: Pick<RuntimeSettings, 'maxToolSteps' | 'llmTraceRequests'>;
  tools: Record<string, Tool>;
  abortSignal?: AbortSignal;
  outputTokenLimits: { maxOutputTokens: number };
  systemPrompt: string;
  messages: ModelMessage[];
}): Promise<Response> {
  const {
    conversationId,
    userId,
    model,
    registry,
    runtimeSettings,
    tools,
    abortSignal,
    outputTokenLimits,
    systemPrompt,
    messages,
  } = params;
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
      await persistAgentTurn(saveMessage, conversationId, userId, text, loose);
    } catch (error) {
      console.error(error);
    }
    await closeAll();
  };

  try {
    const result = streamText({
      model: model.languageModel,
      maxOutputTokens: outputTokenLimits.maxOutputTokens,
      system: systemPrompt,
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
