import { HTTPException } from 'hono/http-exception';
import { getRuntimeSettings, type AgentProfile } from '../runtime-config/store.js';
import type { ResolvedModel } from '../llm/provider.js';
import { createMemoryClient } from '../memory/client.js';
import type { MemoryService } from 'agent-runtime-memory-contract';
import { prepareTurnContext, type IncomingImage } from './turn-context.js';
import type { Principal } from '../auth/principal.js';
import { delegationEncryptionEnabled } from '../delegations/payload.js';
import { prepareAgentTurnTools } from './turn-tools.js';
import { streamPreparedAgentTurn } from './turn-stream.js';

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

  const { registry, tools } = await prepareAgentTurnTools({
    mcpConfig: runtimeSettings.mcpConfig,
    accessToken,
    mcpTokens,
    memory,
    principal,
    conversationId,
    delegationEnabled: delegationEncryptionEnabled(),
  });

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

  return streamPreparedAgentTurn({
    conversationId,
    userId: principal.userId,
    model,
    memory,
    registry,
    runtimeSettings,
    tools,
    abortSignal,
    ...preparedContext,
  });
}
