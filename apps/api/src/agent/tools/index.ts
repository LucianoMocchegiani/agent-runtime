import { type Tool } from 'ai';
import { buildConversationTools } from './conversations.js';
import type { AgentToolContext } from './context.js';
import { buildDelegationTools } from './delegations.js';
import { buildMemoryTools } from './memory.js';
import { buildObjectiveTools } from './objectives.js';

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
  userOnlyToolNames: ReadonlySet<string> = new Set(),
): Record<string, Tool> {
  const agentTools = {
    ...buildConversationTools(context),
    ...buildMemoryTools(context),
    ...buildObjectiveTools(context),
    ...(context.delegationEnabled ? buildDelegationTools(context) : {}),
  };

  if (Object.keys(agentTools).some((name) => Object.hasOwn(mcpTools, name))) {
    throw new AgentToolNameConflictError();
  }

  const preparedMcpTools = Object.fromEntries(
    Object.entries(mcpTools).map(([name, rawTool]) => {
      if (!context.confirmUserOnlyTools || !userOnlyToolNames.has(name)) {
        return [name, rawTool];
      }
      const tool = rawTool as Tool & { execute?: (input: unknown) => unknown };
      if (!tool.execute) return [name, tool];
      return [name, {
        ...tool,
        execute: async () => ({
          userOnlyApproval: true,
          message: 'La acción requiere confirmación explícita del usuario y todavía no fue ejecutada.',
        }),
      } as Tool];
    }),
  );

  return { ...preparedMcpTools, ...agentTools };
}
