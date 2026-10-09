import { generateText, jsonSchema, streamText, tool, type ModelMessage, type Tool } from 'ai';
import { HTTPException } from 'hono/http-exception';
import { getRuntimeSettings, type RuntimeSettings } from '../runtime-config/store.js';
import { isAbortError, identifiedFacingLlmError } from '../llm/errors.js';
import type { ResolvedModel } from '../llm/provider.js';
import { McpRegistry } from '../mcp/registry.js';
import {
  createMemoryMcpClient,
} from '../memory/client.js';
import {
  toJsonValue,
  type GetContextResult,
  type MemoryMcp,
  type MessageDto,
} from 'agent-runtime-memory-contract';
import {
  resolveTokenReserves,
  selectModelContext,
  shrinkToolContent,
} from './window.js';
import type { Principal } from '../auth/principal.js';

type IncomingImage = { data: Uint8Array; mediaType: string };

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

function traceValue(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (key, item: unknown) => {
    if (typeof item === 'function') {
      return `[Function${item.name ? ` ${item.name}` : ''} omitted]`;
    }
    if (typeof item === 'bigint') {
      return item.toString();
    }
    if (item instanceof Uint8Array) {
      return `[Binary omitted: ${item.byteLength} bytes]`;
    }
    if (item instanceof ArrayBuffer) {
      return `[Binary omitted: ${item.byteLength} bytes]`;
    }
    if (ArrayBuffer.isView(item)) {
      return `[Binary omitted: ${item.byteLength} bytes]`;
    }
    if (item instanceof URL) {
      return `${item.origin}${item.pathname}?<query-redacted>`;
    }
    if (typeof item === 'string' && (key === 'image' || key === 'data' || key === 'base64')) {
      if (item.startsWith('data:') || item.length > 2_000) {
        return `[Image/data omitted: ${item.length} characters]`;
      }
    }
    if (typeof item === 'object' && item !== null) {
      if (seen.has(item)) {
        return '[Circular/reference omitted]';
      }
      seen.add(item);
    }
    return item;
  }) ?? 'null';
}

function traceText(value: unknown, maxLength = 4_000): string {
  const text = typeof value === 'string' ? value : traceValue(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}… [truncado; ${text.length} caracteres]`;
}

function formatMessageContent(content: unknown): string {
  if (typeof content === 'string') return traceText(content);
  if (!Array.isArray(content)) return traceText(content);
  return content.map((part) => {
    if (typeof part !== 'object' || part === null) return traceText(part, 1_000);
    const item = part as Record<string, unknown>;
    if (item.type === 'text' && typeof item.text === 'string') return traceText(item.text);
    if (item.type === 'image') {
      const image = item.image;
      const size = image instanceof Uint8Array ? image.byteLength : undefined;
      return `[imagen${typeof item.mediaType === 'string' ? ` ${item.mediaType}` : ''}${size ? `, ${size} bytes` : ''}]`;
    }
    return traceText(item, 1_000);
  }).join('\n');
}

function schemaObject(toolValue: unknown): Record<string, unknown> | undefined {
  if (typeof toolValue !== 'object' || toolValue === null) return undefined;
  const toolObject = toolValue as Record<string, unknown>;
  const input = toolObject.inputSchema;
  if (typeof input !== 'object' || input === null) return undefined;
  const schema = (input as Record<string, unknown>).jsonSchema ?? input;
  return typeof schema === 'object' && schema !== null ? schema as Record<string, unknown> : undefined;
}

function formatTool(name: string, value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [`- ${name}`];
  const item = value as Record<string, unknown>;
  const schema = schemaObject(item);
  const properties = schema?.properties;
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((key): key is string => typeof key === 'string') : []);
  const params = typeof properties === 'object' && properties !== null
    ? Object.entries(properties as Record<string, unknown>).map(([key, definition]) => {
      const field = typeof definition === 'object' && definition !== null ? definition as Record<string, unknown> : {};
      const type = typeof field.type === 'string' ? field.type : 'any';
      return `${key}${required.has(key) ? '' : '?'}: ${type}`;
    })
    : [];
  const lines = [`- ${name}(${params.join(', ')})`];
  if (typeof item.description === 'string' && item.description.trim()) {
    lines.push(`  ${traceText(item.description, 500)}`);
  }
  return lines;
}

function formatLlmRequestTrace(request: {
  conversationId: string;
  step: number;
  model: string;
  maxOutputTokens: number;
  system: unknown;
  messages: unknown;
  tools: unknown;
  activeTools: unknown;
}): string {
  const lines = [
    `[llm-request] ${request.model} | paso ${request.step} | maxOutputTokens=${request.maxOutputTokens} | conversation=${request.conversationId}`,
    '',
    'SYSTEM:',
    traceText(request.system),
    '',
  ];
  const messages = Array.isArray(request.messages) ? request.messages : [];
  lines.push(`MENSAJES (${messages.length}):`);
  messages.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      lines.push(`  [${index + 1}] ${traceText(entry, 1_000)}`);
      return;
    }
    const message = entry as Record<string, unknown>;
    const role = typeof message.role === 'string' ? message.role.toUpperCase() : 'MENSAJE';
    lines.push(`  [${index + 1}] ${role}:`);
    const content = formatMessageContent(message.content);
    for (const line of content.split('\n')) lines.push(`      ${line}`);
  });
  const tools = typeof request.tools === 'object' && request.tools !== null
    ? Object.entries(request.tools as Record<string, unknown>)
    : [];
  lines.push('', `HERRAMIENTAS (${tools.length}):`);
  for (const [name, value] of tools) lines.push(...formatTool(name, value));
  if (Array.isArray(request.activeTools)) {
    lines.push(`Activas: ${request.activeTools.join(', ') || 'ninguna'}`);
  }
  return lines.join('\n');
}

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
  memory: MemoryMcp,
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

async function persistAgentTurn(
  memory: MemoryMcp,
  conversationId: string,
  userId: string,
  text: string | undefined,
  steps: LooseStep[],
): Promise<void> {
  let savedStepText = false;
  for (const step of steps) {
    const stepText = step.text?.trim();
    if (stepText) {
      await memory.saveMessage({
        conversationId,
        userId,
        role: 'assistant',
        content: stepText,
      });
      savedStepText = true;
    }

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
  if (!savedStepText && trimmed) {
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
  model: ResolvedModel,
  abortSignal?: AbortSignal,
  mcpTokens?: Record<string, string>,
  images: IncomingImage[] = [],
): Promise<Response> {
  const failMessage = 'El asistente no está disponible.';
  // El turno conserva una configuración coherente incluso si otra versión se publica mientras corre.
  const runtimeSettings = getRuntimeSettings();
  const turnSystemPrompt = runtimeSettings.chatSystemPrompt;

  let memory: MemoryMcp;
  try {
    memory = await createMemoryMcpClient();
  } catch (error) {
    console.error(error);
    throw new HTTPException(502, { message: failMessage });
  }

  let registry: McpRegistry;
  try {
    registry = new McpRegistry(runtimeSettings.mcpConfig);
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

  const memorySearchToolName = 'memory__searchMemory';
  if (Object.hasOwn(tools, memorySearchToolName)) {
    await registry.close().catch(() => undefined);
    await memory.close().catch(() => undefined);
    throw new HTTPException(502, { message: failMessage });
  }
  tools[memorySearchToolName] = tool({
    description:
      'Busca en los recuerdos y mensajes anteriores del usuario autenticado. Usala cuando la respuesta dependa de conversaciones previas o cuando el usuario pregunte qué se habló o decidió antes. Para buscar en todas las conversaciones, omití por completo conversationId; no lo envíes como cadena vacía. Incluilo solo si el usuario pide limitar la búsqueda a una conversación concreta y tenés su ID.',
    inputSchema: jsonSchema<{
      query: string;
      conversationId?: string;
      limit?: number;
    }>({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Qué información o tema buscar en recuerdos anteriores.',
        },
        conversationId: {
          type: 'string',
          description:
            'Opcional. Incluilo solo para limitar la búsqueda a una conversación concreta. Para buscar en todas las conversaciones, omití este campo por completo; nunca envíes "".',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Cantidad máxima de resultados (1 a 20).',
        },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    execute: async ({ query, conversationId: searchConversationId, limit }) => {
      console.info('tool memory__searchMemory invoked');
      const normalizedConversationId = searchConversationId?.trim() || undefined;
      return memory.searchMemory({
        userId: principal.userId,
        query,
        ...(normalizedConversationId
          ? { conversationId: normalizedConversationId }
          : {}),
        limit,
      });
    },
  });

  const preferenceToolNames = [
    'memory__savePreference',
    'memory__listPreferences',
    'memory__deletePreference',
  ];
  if (preferenceToolNames.some((name) => Object.hasOwn(tools, name))) {
    await registry.close().catch(() => undefined);
    await memory.close().catch(() => undefined);
    throw new HTTPException(502, { message: failMessage });
  }
  tools.memory__savePreference = tool({
    description: 'Guarda una preferencia solo cuando el usuario pide explícitamente que se recuerde o se aplique en el futuro. No guardes instrucciones puntuales de la tarea actual ni infieras preferencias permanentes. Expresá claramente la condición de activación.',
    inputSchema: jsonSchema<{
      preference: string;
      activationCondition: string;
      category?: string;
    }>({
      type: 'object',
      properties: {
        preference: { type: 'string', minLength: 1, maxLength: 2_000, description: 'La instrucción de trabajo preferida por el usuario.' },
        activationCondition: { type: 'string', minLength: 1, maxLength: 1_000, description: 'En qué tipo de pedidos o situaciones se activa.' },
        category: { type: 'string', maxLength: 100, description: 'Categoría breve, por ejemplo: cambios de código.' },
      },
      required: ['preference', 'activationCondition'],
      additionalProperties: false,
    }),
    execute: async ({ preference, activationCondition, category }) => {
      console.info('tool memory__savePreference invoked');
      return memory.savePreference({
        userId: principal.userId,
        preference,
        activationCondition,
        category,
      });
    },
  });
  tools.memory__listPreferences = tool({
    description: 'Lista preferencias guardadas cuando el usuario pregunta cuáles recuerda o quiere administrarlas.',
    inputSchema: jsonSchema<Record<string, never>>({
      type: 'object',
      properties: {},
      additionalProperties: false,
    }),
    execute: async () => memory.listPreferences({ userId: principal.userId }),
  });
  tools.memory__deletePreference = tool({
    description: 'Elimina permanentemente una preferencia guardada cuando el usuario pide olvidarla, eliminarla o reemplazarla. Para reemplazarla, lista si hace falta, elimina la anterior y guarda la nueva con memory__savePreference.',
    inputSchema: jsonSchema<{ id: string }>({
      type: 'object',
      properties: { id: { type: 'string', description: 'ID de la preferencia obtenida al listarla.' } },
      required: ['id'],
      additionalProperties: false,
    }),
    execute: async ({ id }) => memory.deletePreference({ userId: principal.userId, id }),
  });

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
    });
  } catch (error) {
    await registry.close().catch(() => undefined);
    await memory.close().catch(() => undefined);
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

  const tokenReserves = resolveTokenReserves(
    model.contextWindowTokens,
    runtimeSettings.responseTokenReserve,
    runtimeSettings.contextSafetyTokens,
  );
  const selectionOptions = {
    contextWindowTokens: model.contextWindowTokens,
    maxMessages: runtimeSettings.maxContextMessages,
    responseTokenReserve: tokenReserves.responseTokenReserve,
    safetyTokens: tokenReserves.safetyTokens,
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
      maxOutputTokens: tokenReserves.responseTokenReserve,
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
            maxOutputTokens: tokenReserves.responseTokenReserve,
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