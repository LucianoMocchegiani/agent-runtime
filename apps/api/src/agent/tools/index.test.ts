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

test('holds a userOnly MCP tool for explicit approval when enabled', async () => {
  const tools = buildAgentTools({ 'mcp__change': tool }, context, new Set(['mcp__change']));
  const execute = (tools.mcp__change as { execute: () => Promise<unknown> }).execute;
  assert.deepEqual(await execute(), {
    userOnlyApproval: true,
    message: 'La acción requiere confirmación explícita del usuario y todavía no fue ejecutada.',
  });
});

test('keeps userOnly tools automatic when approval is disabled (including delegation turns)', async () => {
  const tools = buildAgentTools({ 'mcp__change': tool }, { ...context, confirmUserOnlyTools: false }, new Set(['mcp__change']));
  const execute = (tools.mcp__change as { execute: () => Promise<unknown> }).execute;
  assert.equal(await execute(), 'executed');
});
