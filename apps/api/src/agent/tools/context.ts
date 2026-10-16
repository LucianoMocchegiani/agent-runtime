import type { MemoryService } from 'agent-runtime-memory/contracts';
import type { Principal } from '../../auth/principal.js';

/** Dependencias e identidad compartidas por los constructores de herramientas del agente. */
export type AgentToolContext = {
  memory: MemoryService;
  principal: Principal;
  conversationId: string;
  accessToken: string;
  mcpTokens?: Record<string, string>;
  delegationEnabled: boolean;
};
