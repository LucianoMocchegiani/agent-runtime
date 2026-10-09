import type { ModelMessage, Tool } from 'ai';
import type { MessageDto } from 'agent-runtime-memory-contract';

const IMAGE_TOKEN_ESTIMATE = 1_024;
const MESSAGE_OVERHEAD_TOKENS = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Mantiene consistentes la reserva de salida y el margen para cualquier ventana configurada. */
export function resolveTokenReserves(
  contextWindowTokens: number,
  responseTokenReserve: number,
  safetyTokens: number,
): { responseTokenReserve: number; safetyTokens: number } {
  const normalizedSafety = Math.min(safetyTokens, Math.max(0, contextWindowTokens - 1));
  const normalizedResponse = Math.min(responseTokenReserve, Math.max(1, contextWindowTokens - normalizedSafety));
  return { responseTokenReserve: normalizedResponse, safetyTokens: normalizedSafety };
}

function stringifyJson(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

function hitCount(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items.length : null;
}

/** Representación acotada de resultados de herramientas para persistencia y resúmenes. */
export function shrinkToolContent(toolName: string, result: unknown, keepDetail: boolean): string {
  const count = hitCount(result);
  if (!keepDetail) return count !== null ? `${toolName} → ${count} hits` : `${toolName} → ok`;
  const raw = typeof result === 'string' ? result : stringifyJson(result);
  return raw.length <= 1500 ? `${toolName} → ${raw}` : `${toolName} → ${raw.slice(0, 1500)}…`;
}

function rowToModelMessage(row: MessageDto): ModelMessage {
  return row.role === 'assistant'
    ? { role: 'assistant', content: row.content }
    : { role: 'user', content: row.content };
}

function messageCost(message: ModelMessage): number {
  const content = typeof message.content === 'string' ? message.content : stringifyJson(message.content);
  return estimateTokens(content) + MESSAGE_OVERHEAD_TOKENS;
}

function promptOverhead(systemPrompt: string, tools: Record<string, Tool>): number {
  return estimateTokens(systemPrompt) + estimateTokens(stringifyJson(tools));
}

type TurnGroup = { rows: MessageDto[]; messages: ModelMessage[]; messageRows: MessageDto[] };

/** Selecciona turnos recientes por tokens y cantidad; devuelve aparte lo que se compactará. */
export function selectModelContext(
  rows: MessageDto[],
  options: {
    contextWindowTokens: number;
    responseTokenReserve: number;
    safetyTokens: number;
    systemPrompt: string;
    tools: Record<string, Tool>;
    maxMessages?: number;
    imageCount?: number;
  },
): { messages: ModelMessage[]; omittedRows: MessageDto[] } {
  const groups: TurnGroup[] = [];
  for (const row of rows) {
    if (row.role === 'user' || groups.length === 0) groups.push({ rows: [], messages: [], messageRows: [] });
    const group = groups[groups.length - 1];
    group.rows.push(row);
    // Los resultados de tools quedan persistidos para memoria/auditoría, pero no
    // se reenvían como mensajes de conversación en cada request posterior.
    if (row.role !== 'tool') {
      group.messages.push(rowToModelMessage(row));
      group.messageRows.push(row);
    }
  }

  const maxMessages = Math.max(1, Math.floor(options.maxMessages ?? 20));
  const fixedCost = promptOverhead(options.systemPrompt, options.tools) + (options.imageCount ?? 0) * IMAGE_TOKEN_ESTIMATE;
  const messageBudget = Math.max(0, options.contextWindowTokens - options.responseTokenReserve - options.safetyTokens - fixedCost);
  const kept: TurnGroup[] = [];
  let used = 0;
  let partialGroupPrefix: MessageDto[] = [];
  let keptMessageCount = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    const remainingCount = maxMessages - keptMessageCount;
    if (group.messages.length > remainingCount) {
      // Si ni siquiera el turno más reciente cabe, retenemos sus mensajes finales
      // para respetar el límite absoluto y dejamos el prefijo para el resumen.
      if (kept.length === 0 && remainingCount > 0) {
        const firstKeptRow = group.messageRows[group.messageRows.length - remainingCount];
        const firstKeptIndex = group.rows.findIndex((row) => row.id === firstKeptRow.id);
        partialGroupPrefix = group.rows.slice(0, firstKeptIndex);
        kept.push({
          ...group,
          messages: group.messages.slice(-remainingCount),
          messageRows: group.messageRows.slice(-remainingCount),
        });
        keptMessageCount += remainingCount;
      }
      break;
    }
    const cost = group.messages.reduce((total, message) => total + messageCost(message), 0);
    if (kept.length > 0 && used + cost > messageBudget) break;
    kept.push(group);
    keptMessageCount += group.messages.length;
    used += cost;
  }
  kept.reverse();
  const keptCount = kept.length;
  return {
    messages: kept.flatMap((group) => group.messages),
    omittedRows: [
      ...groups.slice(0, groups.length - keptCount).flatMap((group) => group.rows),
      ...partialGroupPrefix,
    ],
  };
}

/** Compatibilidad con consumidores que solo necesitan los mensajes enviados al modelo. */
export function buildModelMessages(
  rows: MessageDto[],
  options: Parameters<typeof selectModelContext>[1],
): ModelMessage[] {
  return selectModelContext(rows, options).messages;
}
