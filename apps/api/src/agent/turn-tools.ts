import { type Tool } from 'ai';
import { HTTPException } from 'hono/http-exception';
import type { MemoryService } from 'agent-runtime-memory-contract';
import type { Principal } from '../auth/principal.js';
import type { McpConfig } from '../config.js';
import { McpRegistry } from '../mcp/registry.js';
import { AgentToolNameConflictError, buildAgentTools } from './tools.js';

const failMessage = 'El asistente no está disponible.';

/** Connects the MCP servers and assembles the tools available to one agent turn. */
export async function prepareAgentTurnTools(params: {
  mcpConfig: McpConfig;
  accessToken: string;
  mcpTokens?: Record<string, string>;
  memory: MemoryService;
  principal: Principal;
  conversationId: string;
  delegationEnabled: boolean;
}): Promise<{ registry: McpRegistry; tools: Record<string, Tool> }> {
  const { mcpConfig, accessToken, mcpTokens, memory, principal, conversationId, delegationEnabled } = params;

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
      memory,
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
