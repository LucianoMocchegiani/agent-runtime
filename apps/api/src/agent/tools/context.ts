import type { Principal } from '../../auth/contracts.js';

/** Dependencias e identidad compartidas por los constructores de herramientas del agente. */
export type AgentToolContext = {
  principal: Principal;
  conversationId: string;
  accessToken: string;
  mcpTokens?: Record<string, string>;
  delegationEnabled: boolean;
};
