import assert from 'node:assert/strict';
import test from 'node:test';
import type { Tool } from 'ai';
import type { MemoryService } from 'agent-runtime-memory-contract';
import type { Principal } from '../../auth/principal.js';
import { AgentToolNameConflictError, buildAgentTools } from './index.js';

const context = {
  memory: {} as MemoryService,
  principal: { userId: 'user-1', email: null, name: null } satisfies Principal,
  conversationId: 'conversation-1',
  accessToken: 'access-token',
  delegationEnabled: false,
};

test('combines MCP tools with core agent tools without mutating the registry result', () => {
  const mcpTool = {} as Tool;
  const mcpTools = { example_mcp_tool: mcpTool };

  const result = buildAgentTools(mcpTools, context);

  assert.deepEqual(Object.keys(mcpTools), ['example_mcp_tool']);
  assert.equal(result.example_mcp_tool, mcpTool);
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      'example_mcp_tool',
      'list_conversations',
      'create_conversation',
      'memory__searchMemory',
      'memory__savePreference',
      'memory__listPreferences',
      'memory__deletePreference',
    ].sort(),
  );
});

test('adds delegation tools only when delegation is enabled', () => {
  const result = buildAgentTools({}, { ...context, delegationEnabled: true });

  assert.ok(result.delegate_to_conversation);
  assert.ok(result.get_delegation_status);
});

test('rejects MCP tools that collide with reserved agent tool names', () => {
  const alwaysReserved = [
    'list_conversations',
    'create_conversation',
    'memory__searchMemory',
    'memory__savePreference',
    'memory__listPreferences',
    'memory__deletePreference',
  ];
  const delegationReserved = ['delegate_to_conversation', 'get_delegation_status'];

  for (const name of alwaysReserved) {
    assert.throws(
      () => buildAgentTools({ [name]: {} as Tool }, context),
      AgentToolNameConflictError,
    );
  }
  for (const name of delegationReserved) {
    assert.throws(
      () => buildAgentTools({ [name]: {} as Tool }, { ...context, delegationEnabled: true }),
      AgentToolNameConflictError,
    );
  }
});
