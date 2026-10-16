import type { StreamHandlers } from './types.js';

/**
 * Consume el stream UI Message de AI SDK y despacha los eventos normalizados.
 * Los eventos desconocidos o con JSON inválido se ignoran para tolerar extensiones
 * del protocolo sin interrumpir el resto del turno.
 *
 * @param body Cuerpo del stream recibido de la API.
 * @param handlers Callbacks para deltas de texto, herramientas y errores.
 */
export async function consumeUiMessageStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers = {},
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolNames = new Map<string, string>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) dispatchSseBlock(part, handlers, toolNames);
  }
  if (buffer.trim()) dispatchSseBlock(buffer, handlers, toolNames);
}

function dispatchSseBlock(block: string, handlers: StreamHandlers, toolNames: Map<string, string>): void {
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let event: unknown;
    try {
      event = JSON.parse(payload) as unknown;
    } catch {
      continue;
    }
    applyStreamEvent(event, handlers, toolNames);
  }
}

function applyStreamEvent(event: unknown, handlers: StreamHandlers, toolNames: Map<string, string>): void {
  if (typeof event !== 'object' || event === null) return;
  const rec = event as {
    type?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    delta?: unknown;
    errorText?: unknown;
    output?: unknown;
    result?: unknown;
  };
  const type = typeof rec.type === 'string' ? rec.type : '';
  if (type === 'tool-input-start') {
    const id = typeof rec.toolCallId === 'string' ? rec.toolCallId : '';
    const name = typeof rec.toolName === 'string' && rec.toolName.length > 0 ? rec.toolName : 'tool';
    if (id) toolNames.set(id, name);
    if (id) handlers.onToolStart?.(id, name);
    return;
  }
  if (type === 'tool-output-available') {
    const id = typeof rec.toolCallId === 'string' ? rec.toolCallId : '';
    const eventName = typeof rec.toolName === 'string' && rec.toolName.length > 0 ? rec.toolName : undefined;
    const name = eventName ?? toolNames.get(id) ?? 'tool';
    if (id) handlers.onToolDone?.(id, name, rec.output ?? rec.result);
    if (id) toolNames.delete(id);
    return;
  }
  if (type === 'text-delta' && typeof rec.delta === 'string') {
    handlers.onTextDelta?.(rec.delta);
    return;
  }
  if (type === 'error') {
    const message = typeof rec.errorText === 'string' && rec.errorText.trim()
      ? rec.errorText
      : 'El proveedor de IA no está disponible. Reintentá en un momento.';
    handlers.onError?.(message);
  }
}
