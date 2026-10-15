import { streamText, type Tool } from 'ai';
import { HTTPException } from 'hono/http-exception';
import { getRuntimeSettings, type AgentProfile } from '../runtime-config/store.js';
import { isAbortError, identifiedFacingLlmError } from '../llm/errors.js';
import type { ResolvedModel } from '../llm/provider.js';
import { McpRegistry } from '../mcp/registry.js';
import {
  createMemoryClient,
} from '../memory/client.js';
import type { MemoryService } from 'agent-runtime-memory-contract';
import { prepareTurnContext, type IncomingImage } from './turn-context.js';
import type { Principal } from '../auth/principal.js';
import { formatLlmRequestTrace } from './llm-trace.js';
import { persistAgentTurn, type AgentTurnStep } from './turn-persistence.js';
import { delegationEncryptionEnabled } from '../delegations/payload.js';
import { AgentToolNameConflictError, buildAgentTools } from './tools.js';

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

  const preparedContext = await prepareTurnContext({
    memory,
    model,
    conversationId,
    userId: principal.userId,
    userText,
    context,
    runtimeSettings,
    systemPrompt: turnSystemPrompt,
    tools,
    images,
  });
  const { outputTokenLimits, systemPrompt, messages } = preparedContext;

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