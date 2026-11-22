import assert from 'node:assert/strict';
import test from 'node:test';
import type { Tool } from 'ai';
import type { AgentToolContext } from './context.js';
import { buildAgentTools } from './index.js';

const context: AgentToolContext = {
  principal: { userId: 'user-1', email: null, name: null },
  conversationId: 'conversation-1',
  accessToken: 'token',
  delegationEnabled: false,
  confirmUserOnlyTools: true,
};
const tool = {
  description: 'Changes an external record',
  inputSchema: {},
  execute: async () => 'executed',
} as unknown as Tool;

function executeTool(candidate: Tool): () => Promise<unknown> {
  const executable = candidate as unknown as { execute: () => Promise<unknown> };
  assert.equal(typeof executable.execute, 'function');
  return executable.execute;
}

test('holds a userOnly MCP tool for explicit approval when enabled', async () => {
  const tools = buildAgentTools({ mcp__change: tool }, context, new Set(['mcp__change']));
  assert.deepEqual(await executeTool(tools.mcp__change)(), {
    userOnlyApproval: true,
    message: 'La acción requiere confirmación explícita del usuario y todavía no fue ejecutada.',
  });
});

test('keeps userOnly tools automatic when approval is disabled (including delegation turns)', async () => {
  const tools = buildAgentTools({ mcp__change: tool }, { ...context, confirmUserOnlyTools: false }, new Set(['mcp__change']));
  assert.equal(await executeTool(tools.mcp__change)(), 'executed');
});
