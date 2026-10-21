import type { Tool } from 'ai';
import { Ajv, type AnySchema } from 'ajv';
import type { AppEnv } from '../auth/contracts.js';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getConversation } from '../conversations/service.js';
import { requireConversationId } from '../conversations/ids.js';
import { prepareAgentTurnTools } from '../agent/turn/tools.js';
import { delegationEncryptionEnabled } from '../delegations/payload.js';
import { getAgentProfile } from '../runtime-config/agent-profiles.js';
import { getRuntimeSettings } from '../runtime-config/service.js';
import { saveMessage } from '../messages/persistence.js';
import type { JsonValue } from '../messages/contracts.js';

const ajv = new Ajv({ allErrors: false, strict: false });

/** Build per-request tool context from the authenticated conversation, never from client-supplied permissions. */
async function prepareVoiceTools(c: Context<AppEnv>) {
  const conversationId = requireConversationId(c.req.param('id'));
  const conversation = await getConversation(c.get('principal'), conversationId);
  if (conversation.archivedAt) throw new Error('Conversation archived');
  const profile = conversation.agentProfileId ? await getAgentProfile(conversation.agentProfileId, true) : null;
  const settings = getRuntimeSettings(profile ?? undefined);
  const prepared = await prepareAgentTurnTools({
    mcpConfig: settings.mcpConfig,
    accessToken: c.get('accessToken'),
    mcpTokens: c.get('mcpAuth') ?? undefined,
    principal: c.get('principal'),
    conversationId,
    delegationEnabled: delegationEncryptionEnabled(),
  });
  return { ...prepared, conversationId, userId: c.get('principal').userId };
}

function functionName(name: string): string | null {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name) ? name : null;
}

/** Convert the same Runtime tools used by chat to Realtime function schemas. */
export async function listRealtimeVoiceTools(c: Context<AppEnv>): Promise<Array<Record<string, unknown>>> {
  const prepared = await prepareVoiceTools(c);
  try {
    const definitions: Array<Record<string, unknown>> = [];
    for (const [name, candidate] of Object.entries(prepared.tools)) {
      const realtimeName = functionName(name);
      if (!realtimeName) continue;
      const tool = candidate as Tool & { inputSchema?: { jsonSchema?: unknown } };
      const schema = tool.inputSchema as { jsonSchema?: unknown } | undefined;
      const parameters = await (schema?.jsonSchema ?? schema);
      if (!parameters || typeof parameters !== 'object') continue;
      definitions.push({
        type: 'function',
        name: realtimeName,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters,
      });
    }
    return definitions;
  } finally {
    await prepared.registry.close();
  }
}

/** Executes one tool by re-resolving the current authorized toolset on the server for every call. */
export async function executeRealtimeVoiceTool(
  c: Context<AppEnv>,
  name: string,
  rawArguments: string,
  callId: string,
): Promise<unknown> {
  const prepared = await prepareVoiceTools(c);
  try {
    const tool = prepared.tools[name] as (Tool & { execute?: (args: unknown, options: unknown) => Promise<unknown> }) | undefined;
    if (!tool || typeof tool.execute !== 'function') throw new Error('La herramienta solicitada no está habilitada.');
    let args: unknown;
    try { args = JSON.parse(rawArguments); } catch { throw new Error('Los argumentos de la herramienta no son JSON válido.'); }
    const inputSchema = tool.inputSchema as { jsonSchema?: unknown } | undefined;
    const jsonSchema = (await inputSchema?.jsonSchema ?? inputSchema) as AnySchema | undefined;
    if (!jsonSchema || typeof jsonSchema !== 'object') {
      throw new HTTPException(503, { message: 'La herramienta no publica un esquema JSON compatible.' });
    }
    let validate: ReturnType<typeof ajv.compile>;
    try { validate = ajv.compile(jsonSchema); }
    catch { throw new HTTPException(503, { message: 'El esquema JSON de la herramienta no es válido.' }); }
    if (!validate(args)) throw new HTTPException(400, { message: 'Los argumentos no cumplen el esquema de la herramienta.' });
    const result = await tool.execute(args, {
      toolCallId: callId,
      messages: [],
      abortSignal: new AbortController().signal,
    });
    const safeArgs = JSON.parse(JSON.stringify(args ?? null)) as JsonValue;
    const safeResult = JSON.parse(JSON.stringify(result ?? null)) as JsonValue;
    await saveMessage({
      conversationId: prepared.conversationId,
      userId: prepared.userId,
      role: 'tool',
      toolName: name,
      toolArgs: safeArgs,
      toolResult: safeResult,
      content: '',
    });
    return result;
  } finally {
    await prepared.registry.close();
  }
}
