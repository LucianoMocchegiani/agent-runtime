import type { ModelMessage } from 'ai';
import { config } from '../config.js';
import type { MessageDto } from 'agent-runtime-memory-contract';

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hitCount(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items.length : null;
}

/**
 * `tool_result` viejo → una línea. Los dos últimos tools quedan más enteros (tope de chars).
 */
export function shrinkToolContent(
  toolName: string,
  result: unknown,
  keepDetail: boolean,
): string {
  const count = hitCount(result);
  if (!keepDetail) {
    if (count !== null) {
      return `${toolName} → ${count} hits`;
    }
    return `${toolName} → ok`;
  }
  const raw = typeof result === 'string' ? result : stringifyJson(result);
  if (raw.length <= 1500) {
    return `${toolName} → ${raw}`;
  }
  return `${toolName} → ${raw.slice(0, 1500)}…`;
}

function rowToContent(row: MessageDto, keepToolDetail: boolean): string {
  if (row.role === 'tool') {
    const name = row.toolName ?? 'tool';
    return shrinkToolContent(name, row.toolResult, keepToolDetail);
  }
  return row.content;
}

/**
 * Arma el prompt del modelo: system aparte; cola reciente hasta `CHAT_CONTEXT_TOKENS`.
 *
 * @remarks No borra filas. Tools viejas se achican; si no entra, se dejan afuera del prompt.
 */
export function buildModelMessages(rows: MessageDto[]): ModelMessage[] {
  const toolIndexes = rows
    .map((row, index) => (row.role === 'tool' ? index : -1))
    .filter((index) => index >= 0);
  const keepDetail = new Set(toolIndexes.slice(-2));

  const mapped: ModelMessage[] = rows.map((row, index) => {
    const content = rowToContent(row, keepDetail.has(index));
    if (row.role === 'assistant') {
      return { role: 'assistant', content };
    }
    return { role: 'user', content };
  });

  const budget = config.contextTokenBudget;
  const kept: ModelMessage[] = [];
  let used = 0;
  for (let i = mapped.length - 1; i >= 0; i -= 1) {
    const message = mapped[i];
    const text =
      typeof message.content === 'string' ? message.content : stringifyJson(message.content);
    const cost = estimateTokens(text);
    if (kept.length > 0 && used + cost > budget) {
      continue;
    }
    kept.push(message);
    used += cost;
  }
  return kept.reverse();
}
