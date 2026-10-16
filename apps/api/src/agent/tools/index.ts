import { type Tool } from 'ai';
import { buildConversationTools } from './conversations.js';
import type { AgentToolContext } from './context.js';
import { buildDelegationTools } from './delegations.js';
import { buildMemoryTools } from './memory.js';

/** Error cuando una herramienta MCP usa un nombre reservado por las herramientas del agente. */
export class AgentToolNameConflictError extends Error {
  constructor() {
    super('An MCP tool conflicts with a reserved agent tool name.');
    this.name = 'AgentToolNameConflictError';
  }
}

/** Combina las herramientas MCP con las propias del agente y verifica colisiones de nombres. */
export function buildAgentTools(
  mcpTools: Record<string, Tool>,
  context: AgentToolContext,
): Record<string, Tool> {
  const agentTools = {
    ...buildConversationTools(context),
    ...buildMemoryTools(context),
    ...(context.delegationEnabled ? buildDelegationTools(context) : {}),
  };

  if (Object.keys(agentTools).some((name) => Object.hasOwn(mcpTools, name))) {
    throw new AgentToolNameConflictError();
  }

  return { ...mcpTools, ...agentTools };
}
