import { toJsonValue, type MemoryService } from 'agent-runtime-memory-contract';
import { shrinkToolContent } from './window.js';

export type AgentTurnTool = {
  toolName?: string;
  args?: unknown;
  input?: unknown;
  result?: unknown;
  output?: unknown;
};

export type AgentTurnStep = {
  text?: string;
  toolCalls?: AgentTurnTool[];
  toolResults?: AgentTurnTool[];
};

function toolNameOf(item: AgentTurnTool, fallback = 'tool'): string {
  return typeof item.toolName === 'string' && item.toolName.length > 0
    ? item.toolName
    : fallback;
}

function toolArgsOf(item: AgentTurnTool): unknown {
  return item.input ?? item.args;
}

function toolOutputOf(item: AgentTurnTool): unknown {
  return item.output ?? item.result;
}

function assistantTextOf(text: string | undefined, steps: AgentTurnStep[]): string {
  if (text && text.trim()) {
    return text.trim();
  }
  return steps
    .map((step) => (typeof step.text === 'string' ? step.text.trim() : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** Persists assistant text and tool results yielded during a completed or interrupted turn. */
export async function persistAgentTurn(
  memory: MemoryService,
  conversationId: string,
  userId: string,
  text: string | undefined,
  steps: AgentTurnStep[],
): Promise<void> {
  let savedStepText = false;
  for (const step of steps) {
    const stepText = step.text?.trim();
    if (stepText) {
      await memory.saveMessage({
        conversationId,
        userId,
        role: 'assistant',
        content: stepText,
      });
      savedStepText = true;
    }

    const calls = step.toolCalls ?? [];
    const results = step.toolResults ?? [];
    const n = Math.max(calls.length, results.length);
    for (let i = 0; i < n; i += 1) {
      const call = calls[i] ?? {};
      const result = results[i] ?? {};
      const name = toolNameOf(result, toolNameOf(call));
      const args = toolArgsOf(call) ?? toolArgsOf(result);
      const output = toolOutputOf(result);
      await memory.saveMessage({
        conversationId,
        userId,
        role: 'tool',
        toolName: name,
        toolArgs: toJsonValue(args),
        toolResult: toJsonValue(output),
        content: shrinkToolContent(name, output, true),
      });
    }
  }
  const trimmed = assistantTextOf(text, steps);
  if (!savedStepText && trimmed) {
    await memory.saveMessage({
      conversationId,
      userId,
      role: 'assistant',
      content: trimmed,
    });
  }
}
