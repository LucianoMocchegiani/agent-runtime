function traceValue(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (key, item: unknown) => {
    if (typeof item === 'function') {
      return `[Function${item.name ? ` ${item.name}` : ''} omitted]`;
    }
    if (typeof item === 'bigint') {
      return item.toString();
    }
    if (item instanceof Uint8Array) {
      return `[Binary omitted: ${item.byteLength} bytes]`;
    }
    if (item instanceof ArrayBuffer) {
      return `[Binary omitted: ${item.byteLength} bytes]`;
    }
    if (ArrayBuffer.isView(item)) {
      return `[Binary omitted: ${item.byteLength} bytes]`;
    }
    if (item instanceof URL) {
      return `${item.origin}${item.pathname}?<query-redacted>`;
    }
    if (typeof item === 'string' && (key === 'image' || key === 'data' || key === 'base64')) {
      if (item.startsWith('data:') || item.length > 2_000) {
        return `[Image/data omitted: ${item.length} characters]`;
      }
    }
    if (typeof item === 'object' && item !== null) {
      if (seen.has(item)) {
        return '[Circular/reference omitted]';
      }
      seen.add(item);
    }
    return item;
  }) ?? 'null';
}

function traceText(value: unknown, maxLength = 4_000): string {
  const text = typeof value === 'string' ? value : traceValue(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}… [truncado; ${text.length} caracteres]`;
}

function formatMessageContent(content: unknown): string {
  if (typeof content === 'string') return traceText(content);
  if (!Array.isArray(content)) return traceText(content);
  return content.map((part) => {
    if (typeof part !== 'object' || part === null) return traceText(part, 1_000);
    const item = part as Record<string, unknown>;
    if (item.type === 'text' && typeof item.text === 'string') return traceText(item.text);
    if (item.type === 'image') {
      const image = item.image;
      const size = image instanceof Uint8Array ? image.byteLength : undefined;
      return `[imagen${typeof item.mediaType === 'string' ? ` ${item.mediaType}` : ''}${size ? `, ${size} bytes` : ''}]`;
    }
    return traceText(item, 1_000);
  }).join('\n');
}

function schemaObject(toolValue: unknown): Record<string, unknown> | undefined {
  if (typeof toolValue !== 'object' || toolValue === null) return undefined;
  const toolObject = toolValue as Record<string, unknown>;
  const input = toolObject.inputSchema;
  if (typeof input !== 'object' || input === null) return undefined;
  const schema = (input as Record<string, unknown>).jsonSchema ?? input;
  return typeof schema === 'object' && schema !== null ? schema as Record<string, unknown> : undefined;
}

function formatTool(name: string, value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [`- ${name}`];
  const item = value as Record<string, unknown>;
  const schema = schemaObject(item);
  const properties = schema?.properties;
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((key): key is string => typeof key === 'string') : []);
  const params = typeof properties === 'object' && properties !== null
    ? Object.entries(properties as Record<string, unknown>).map(([key, definition]) => {
      const field = typeof definition === 'object' && definition !== null ? definition as Record<string, unknown> : {};
      const type = typeof field.type === 'string' ? field.type : 'any';
      return `${key}${required.has(key) ? '' : '?'}: ${type}`;
    })
    : [];
  const lines = [`- ${name}(${params.join(', ')})`];
  if (typeof item.description === 'string' && item.description.trim()) {
    lines.push(`  ${traceText(item.description, 500)}`);
  }
  return lines;
}

export function formatLlmRequestTrace(request: {
  conversationId: string;
  step: number;
  model: string;
  maxOutputTokens: number;
  system: unknown;
  messages: unknown;
  tools: unknown;
  activeTools: unknown;
}): string {
  const lines = [
    `[llm-request] ${request.model} | paso ${request.step} | maxOutputTokens=${request.maxOutputTokens} | conversation=${request.conversationId}`,
    '',
    'SYSTEM:',
    traceText(request.system),
    '',
  ];
  const messages = Array.isArray(request.messages) ? request.messages : [];
  lines.push(`MENSAJES (${messages.length}):`);
  messages.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      lines.push(`  [${index + 1}] ${traceText(entry, 1_000)}`);
      return;
    }
    const message = entry as Record<string, unknown>;
    const role = typeof message.role === 'string' ? message.role.toUpperCase() : 'MENSAJE';
    lines.push(`  [${index + 1}] ${role}:`);
    const content = formatMessageContent(message.content);
    for (const line of content.split('\n')) lines.push(`      ${line}`);
  });
  const tools = typeof request.tools === 'object' && request.tools !== null
    ? Object.entries(request.tools as Record<string, unknown>)
    : [];
  lines.push('', `HERRAMIENTAS (${tools.length}):`);
  for (const [name, value] of tools) lines.push(...formatTool(name, value));
  if (Array.isArray(request.activeTools)) {
    lines.push(`Activas: ${request.activeTools.join(', ') || 'ninguna'}`);
  }
  return lines.join('\n');
}
