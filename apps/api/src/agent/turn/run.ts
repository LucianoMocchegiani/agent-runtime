import { HTTPException } from 'hono/http-exception';
import { getRuntimeSettings, type AgentProfile } from '../../runtime-config/service.js';
import type { ResolvedModel } from '../../llm/provider.js';
import { applyAutomaticTitle } from '../../conversations/persistence.js';
import { getContext, saveMessage, saveSummary } from '../../messages/persistence.js';
import { searchPreferences } from '../../preferences/persistence.js';
import { prepareTurnContext, type IncomingImage } from './context.js';
import type { Principal } from '../../auth/contracts.js';
import { delegationEncryptionEnabled } from '../../delegations/payload.js';
import { prepareAgentTurnTools } from './tools.js';
import { streamPreparedAgentTurn } from './stream.js';

/**
 * Ejecuta un turno completo: prepara herramientas/contexto, invoca el modelo y devuelve el stream UI.
 * @remarks La cancelación del cliente interrumpe el modelo y persiste lo generado hasta ese punto.
 * @throws {HTTPException} 502 si no se puede preparar o ejecutar la dependencia requerida.
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
  agentProfile?: Pick<AgentProfile, 'id' | 'name' | 'model' | 'config'>,
  options: { userMessageAlreadySaved?: boolean } = {},
): Promise<Response> {
  const failMessage = 'El asistente no está disponible.';
  // El turno conserva una configuración coherente incluso si otra versión se publica mientras corre.
  const runtimeSettings = getRuntimeSettings(agentProfile);
  const turnSystemPrompt = delegationEncryptionEnabled()
    ? `${runtimeSettings.chatSystemPrompt}\n\nDelegaciones: solo usá delegate_to_conversation cuando el usuario haya pedido explícitamente delegar trabajo a otro hilo. Nunca elijas ni delegues tareas por iniciativa propia. No interpretes la mera disponibilidad de la herramienta como autorización.`
    : runtimeSettings.chatSystemPrompt;

  const { registry, tools } = await prepareAgentTurnTools({
    mcpConfig: runtimeSettings.mcpConfig,
    accessToken,
    mcpTokens,
    principal,
    conversationId,
    delegationEnabled: delegationEncryptionEnabled(),
  });

  if (!options.userMessageAlreadySaved) {
    await saveMessage({
      conversationId,
      userId: principal.userId,
      role: 'user',
      content: userText,
    });
  }
  await applyAutomaticTitle({
    conversationId,
    userId: principal.userId,
    userText,
  });

  let context;
  try {
    context = await getContext({
      conversationId,
      userId: principal.userId,
    });
  } catch (error) {
    await registry.close().catch(() => undefined);
    console.error(error);
    throw new HTTPException(502, { message: failMessage });
  }

  const preparedContext = await prepareTurnContext({
    saveSummary,
    searchPreferences,
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
    registry,
    runtimeSettings,
    tools,
    abortSignal,
    ...preparedContext,
  });
}
