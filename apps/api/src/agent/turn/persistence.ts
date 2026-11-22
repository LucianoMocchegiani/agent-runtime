import { toJsonValue } from './json.js';
import { shrinkToolContent } from '../window/index.js';

export type AgentTurnTool = { toolName?: string; args?: unknown; input?: unknown; result?: unknown; output?: unknown };
export type AgentTurnStep = { text?: string; toolCalls?: AgentTurnTool[]; toolResults?: AgentTurnTool[] };

function toolNameOf(item: AgentTurnTool, fallback = 'tool'): string {
  return typeof item.toolName === 'string' && item.toolName.length > 0 ? item.toolName : fallback;
}
function toolArgsOf(item: AgentTurnTool): unknown { return item.input ?? item.args; }
function toolOutputOf(item: AgentTurnTool): unknown { return item.output ?? item.result; }
function isApprovalRequest(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (value as { userOnlyApproval?: unknown }).userOnlyApproval === true;
}
function assistantTextOf(text: string | undefined, steps: AgentTurnStep[]): string {
  if (text?.trim()) return text.trim();
  return steps.map((step) => (typeof step.text === 'string' ? step.text.trim() : '')).filter(Boolean).join('\n').trim();
}

/** Persiste texto y resultados; las acciones userOnly quedan guardadas pendientes, nunca ejecutadas. */
export async function persistAgentTurn(
  saveMessage: typeof import('../../messages/persistence.js').saveMessage,
  conversationId: string,
  userId: string,
  text: string | undefined,
  steps: AgentTurnStep[],
): Promise<void> {
  let savedStepText = false;
  for (const step of steps) {
    const stepText = step.text?.trim();
    if (stepText) {
      await saveMessage({ conversationId, userId, role: 'assistant', content: stepText });
      savedStepText = true;
    }
    const calls = step.toolCalls ?? [];
    const results = step.toolResults ?? [];
    for (let i = 0; i < Math.max(calls.length, results.length); i += 1) {
      const call = calls[i] ?? {};
      const result = results[i] ?? {};
      const name = toolNameOf(result, toolNameOf(call));
      const args = toolArgsOf(call) ?? toolArgsOf(result);
      const output = toolOutputOf(result);
      if (isApprovalRequest(output)) {
        await saveMessage({
          conversationId,
          userId,
          role: 'tool',
          toolName: name,
          toolArgs: toJsonValue(args),
          toolResult: { state: 'approval_pending' },
          content: `Esperando confirmación para ejecutar ${name}.`,
        });
        continue;
      }
      await saveMessage({
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
  if (!savedStepText && trimmed) await saveMessage({ conversationId, userId, role: 'assistant', content: trimmed });
}
