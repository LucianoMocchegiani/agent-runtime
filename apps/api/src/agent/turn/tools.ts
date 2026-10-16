import { type Tool } from 'ai';
import { HTTPException } from 'hono/http-exception';
import type { Principal } from '../../auth/contracts.js';
import type { McpConfig } from '../../config.js';
import { McpRegistry } from '../../mcp/registry.js';
import { AgentToolNameConflictError, buildAgentTools } from '../tools/index.js';

const failMessage = 'El asistente no está disponible.';

/** Conecta los servidores MCP y reúne las herramientas disponibles para un turno. */
export async function prepareAgentTurnTools(params: {
  mcpConfig: McpConfig;
  accessToken: string;
  mcpTokens?: Record<string, string>;
  principal: Principal;
  conversationId: string;
  delegationEnabled: boolean;
}): Promise<{ registry: McpRegistry; tools: Record<string, Tool> }> {
  const { mcpConfig, accessToken, mcpTokens, principal, conversationId, delegationEnabled } = params;

  let registry: McpRegistry;
  try {
    registry = new McpRegistry(mcpConfig);
    await registry.connect(accessToken, mcpTokens);
  } catch (error) {
    console.error(error);
    throw new HTTPException(502, { message: failMessage });
  }

  try {
    const mcpTools = await registry.getAllTools() as Record<string, Tool>;
    const tools = buildAgentTools(mcpTools, {
      principal,
      conversationId,
      accessToken,
      mcpTokens,
      delegationEnabled,
    });
    return { registry, tools };
  } catch (error) {
    await registry.close().catch(() => undefined);
    if (!(error instanceof AgentToolNameConflictError)) {
      console.error(error);
    }
    throw new HTTPException(502, { message: failMessage });
  }
}
