import { streamText, type Tool } from 'ai';
import { HTTPException } from 'hono/http-exception';
import { config } from '../config.js';
import { isAbortError, identifiedFacingLlmError } from '../llm/errors.js';
import type { ResolvedModel } from '../llm/provider.js';
import { McpRegistry } from '../mcp/registry.js';
import {
  createMemoryMcpClient,
} from '../memory/client.js';
import {
  toJsonValue,
  type MemoryMcp,
} from 'agent-runtime-memory-contract';
import { buildModelMessages, shrinkToolContent } from './window.js';
import type { Principal } from '../auth/principal.js';

type LooseTool = {
  toolName?: string;
  args?: unknown;
  input?: unknown;
  result?: unknown;
  output?: unknown;
};

type LooseStep = {
  text?: string;
  toolCalls?: LooseTool[];
  toolResults?: LooseTool[];
};

function toolNameOf(item: LooseTool, fallback = 'tool'): string {
  return typeof item.toolName === 'string' && item.toolName.length > 0
    ? item.toolName
    : fallback;
}

function toolArgsOf(item: LooseTool): unknown {
  return item.input ?? item.args;
}

function toolOutputOf(item: LooseTool): unknown {
  return item.output ?? item.result;
}

function assistantTextOf(text: string | undefined, steps: LooseStep[]): string {
  if (text && text.trim()) {
    return text.trim();
  }
  return steps
    .map((step) => (typeof step.text === 'string' ? step.text.trim() : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function persistAgentTurn(
  memory: MemoryMcp,
  conversationId: string,
  userId: string,
  text: string | undefined,
  steps: LooseStep[],
): Promise<void> {
  for (const step of steps) {
    const calls = step.toolCalls ?? [];
    const results = step.toolResults ?? [];
    const n = Math.max(calls.length, results.length);
    for (let i = 0; i < n; i += 1) {
      const call = calls[i] ?? {};
      const result = results[i] ?? {};
      const name = toolNameOf(result, toolNameOf(call));
      const args = toolArgsOf(call) ?? toolArgsOf(result);
      const output = toolOutputOf(result);
      await memory.saveMessage({
        conversationId,
        userId,
        role: 'tool',
        toolName: name,
        toolArgs: toJsonValue(args),
        toolResult: toJsonValue(output),
        content: shrinkToolContent(name, output, true),
      });
    }
  }
  const trimmed = text?.trim();
  if (trimmed && trimmed.length > 0) {
      await memory.saveMessage({
        conversationId,
        userId,
        role: 'assistant',
        content: trimmed,
      });
  }
}

/**
 * Corre un turno: Memory MCP + Domain MCP + OpenRouter + stream UI.
 *
 * @remarks Abort del cliente (`AbortSignal`) corta el LLM y guarda lo ya generado.
 * @throws {HTTPException} 502 si Memory MCP, Domain MCP o OpenRouter no arrancan.
 */
export async function streamAgentTurn(
  conversationId: string,
  principal: Principal,
  accessToken: string,
  userText: string,
  systemPrompt: string,
  model: ResolvedModel,
  abortSignal?: AbortSignal,
  mcpTokens?: Record<string, string>,
): Promise<Response> {
  const failMessage = 'El asistente no está disponible.';

  let memory: MemoryMcp;
  try {
    memory = await createMemoryMcpClient();
  } catch (error) {
    console.error(error);
    throw new HTTPException(502, { message: failMessage });
  }

  let registry: McpRegistry;
  try {
    registry = McpRegistry.fromConfig();
    await registry.connect(accessToken, mcpTokens);
  } catch (error) {
    console.error(error);
    await memory.close().catch(() => undefined);
    throw new HTTPException(502, { message: failMessage });
  }

  let tools: Record<string, Tool>;
  try {
    tools = await registry.getAllTools() as Record<string, Tool>;
  } catch (error) {
    await registry.close().catch(() => undefined);
    await memory.close().catch(() => undefined);
    console.error(error);
    throw new HTTPException(502, { message: failMessage });
  }

  await memory.saveMessage({
    conversationId,
    userId: principal.userId,
    role: 'user',
    content: userText,
  });
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
      tokenBudget: config.contextTokenBudget,
    });
  } catch (error) {
    await registry.close().catch(() => undefined);
    await memory.close().catch(() => undefined);
    console.error(error);
    throw new HTTPException(502, { message: failMessage });
  }

  const messages = buildModelMessages(context.messages);

  let closed = false;
  const closeAll = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await registry.close().catch(() => undefined);
    await memory.close().catch(() => undefined);
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
  const acc: LooseStep[] = [];
  const saveOnce = async (text: string | undefined, steps: unknown) => {
    if (saved) {
      await closeAll();
      return;
    }
    saved = true;
    const loose = Array.isArray(steps) ? (steps as LooseStep[]) : acc;
    try {
      await persistAgentTurn(
        memory,
        conversationId,
        principal.userId,
        assistantTextOf(text, loose),
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
      system: systemPrompt,
      messages,
      tools,
      abortSignal,
      stopWhen: ({ steps }) => steps.length >= config.maxToolSteps,
      onStepFinish: (step) => {
        acc.push(step as LooseStep);
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
        const fromEvent = Array.isArray(steps) ? (steps as LooseStep[]) : [];
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