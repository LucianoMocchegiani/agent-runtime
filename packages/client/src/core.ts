/**
 * Cliente genérico para agent-runtime.
 *
 * Usa el protocolo UI Message Stream (AI SDK).
 * No depende de framework UI.
 */

export type ClientConfig = {
  baseUrl: string;
  getBearer: () => string | null;
  getMcpAuth?: () => Record<string, string> | null;
};

export type Conversation = {
  id: string;
  userId: string;
  title: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  agentProfileId: string | null;
};

export type AgentProfileInfo = { id: string; name: string; modelId: string };

export type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName: string | null;
  toolArgs: unknown;
  toolResult: unknown;
  createdAt: string;
};

export type MessageCursor = { createdAt: string; id: string };
export type MessagePage = {
  items: Message[];
  hasMore: boolean;
  nextCursor: MessageCursor | null;
};
export type MessageListOptions = { limit?: number; before?: MessageCursor };

export type ModelInfo = {
  /** `proveedor/modelo`; se manda como `model` en `messages.send`. */
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
};

export type ModelList = {
  default: string;
  items: ModelInfo[];
};

export type SendOptions = {
  /** Data URLs temporales de imágenes; el servidor no las persiste. */
  images?: string[];
  /** Compatibilidad con clientes antiguos que envían una sola imagen. */
  image?: string | null;
};

export type StreamHandlers = {
  onTextDelta?: (delta: string) => void;
  onToolStart?: (toolCallId: string, toolName: string) => void;
  onToolDone?: (toolCallId: string, toolName: string, output?: unknown) => void;
  onError?: (message: string) => void;
  onFinish?: () => void;
};

function baseUrl(config: ClientConfig): string {
  return config.baseUrl.replace(/\/$/, '');
}

function bearer(config: ClientConfig): Record<string, string> {
  const token = config.getBearer?.();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function mcpAuth(config: ClientConfig): Record<string, string> {
  const auth = config.getMcpAuth?.();
  return auth ? { 'X-MCP-Auth': JSON.stringify(auth) } : {};
}

function headers(config: ClientConfig, extra: Record<string, string> = {}): Record<string, string> {
  return { ...bearer(config), ...mcpAuth(config), ...extra };
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    return null as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ClientError(res.status, text);
  }
}

export class ClientError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ClientError';
  }
}

export function createClient(config: ClientConfig) {
  return {
    conversations: {
      list: async (): Promise<Conversation[]> => {
        const res = await fetch(`${baseUrl(config)}/v1/conversations`, {
          headers: headers(config, { Accept: 'application/json' }),
        });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        const data = await json<{ items: Conversation[] }>(res);
        return data?.items ?? [];
      },

      create: async (options: { agentProfileId?: string } = {}): Promise<Conversation> => {
        const res = await fetch(`${baseUrl(config)}/v1/conversations`, {
          method: 'POST',
          headers: headers(config, {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
          body: JSON.stringify(options),
        });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        return json<Conversation>(res);
      },

      get: async (id: string): Promise<Conversation> => {
        const res = await fetch(`${baseUrl(config)}/v1/conversations/${id}`, {
          headers: headers(config, { Accept: 'application/json' }),
        });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        return json<Conversation>(res);
      },

      archive: async (id: string): Promise<Conversation> => {
        const res = await fetch(`${baseUrl(config)}/v1/conversations/${id}`, {
          method: 'DELETE',
          headers: headers(config),
        });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        return json<Conversation>(res);
      },

      patch: async (
        id: string,
        patch: { title?: string | null; archived?: boolean; agentProfileId?: string | null },
      ): Promise<Conversation> => {
        const res = await fetch(`${baseUrl(config)}/v1/conversations/${id}`, {
          method: 'PATCH',
          headers: headers(config, {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        return json<Conversation>(res);
      },
    },

    models: {
      list: async (): Promise<ModelList> => {
        const res = await fetch(`${baseUrl(config)}/v1/models`, {
          headers: headers(config, { Accept: 'application/json' }),
        });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        const data = await json<ModelList>(res);
        return { default: data?.default ?? '', items: data?.items ?? [] };
      },
    },

    agentProfiles: {
      list: async (): Promise<AgentProfileInfo[]> => {
        const res = await fetch(`${baseUrl(config)}/v1/agent-profiles`, { headers: headers(config, { Accept: 'application/json' }) });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        const data = await json<{ items: AgentProfileInfo[] }>(res);
        return data?.items ?? [];
      },
    },

    messages: {
      list: async (conversationId: string, options: MessageListOptions = {}): Promise<MessagePage> => {
        const query = new URLSearchParams();
        if (options.limit !== undefined) query.set('limit', String(options.limit));
        if (options.before) {
          query.set('beforeCreatedAt', options.before.createdAt);
          query.set('beforeId', options.before.id);
        }
        const suffix = query.size ? `?${query.toString()}` : '';
        const res = await fetch(
          `${baseUrl(config)}/v1/conversations/${conversationId}/messages${suffix}`,
          { headers: headers(config, { Accept: 'application/json' }) },
        );
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        const data = await json<MessagePage>(res);
        return data ?? { items: [], hasMore: false, nextCursor: null };
      },

      send: async (
        conversationId: string,
        text: string,
        handlers: StreamHandlers = {},
        signal?: AbortSignal,
        options: SendOptions = {},
      ): Promise<'ok' | 'aborted'> => {
        try {
          const res = await fetch(
            `${baseUrl(config)}/v1/conversations/${conversationId}/messages`,
            {
              method: 'POST',
              headers: headers(config, {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
              }),
              body: JSON.stringify({
                text,
                ...(options.images?.length ? { images: options.images } : {}),
                ...(!options.images?.length && options.image ? { image: options.image } : {}),
              }),
              signal,
            },
          );

          if (!res.ok) {
            const parsed = await json<unknown>(res);
            const message =
              typeof parsed === 'object' && parsed !== null
                ? (parsed as { error?: string; message?: string }).error ??
                  (parsed as { error?: string; message?: string }).message ??
                  `Error HTTP ${res.status}`
                : `Error HTTP ${res.status}`;
            throw new ClientError(res.status, message);
          }

          if (!res.body) {
            throw new ClientError(502, 'El asistente no está disponible.');
          }

          await consumeUiMessageStream(res.body, handlers);
          if (signal?.aborted) {
            return 'aborted';
          }
          handlers.onFinish?.();
          return 'ok';
        } catch (error) {
          if (isAbortError(error)) {
            return 'aborted';
          }
          throw error;
        }
      },
    },
  };
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

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
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      dispatchSseBlock(part, handlers, toolNames);
    }
  }
  if (buffer.trim()) {
    dispatchSseBlock(buffer, handlers, toolNames);
  }
}

function dispatchSseBlock(
  block: string,
  handlers: StreamHandlers,
  toolNames: Map<string, string>,
): void {
  const lines = block.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      continue;
    }
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(payload) as unknown;
    } catch {
      continue;
    }
    applyStreamEvent(event, handlers, toolNames);
  }
}

function applyStreamEvent(
  event: unknown,
  handlers: StreamHandlers,
  toolNames: Map<string, string>,
): void {
  if (typeof event !== 'object' || event === null) {
    return;
  }
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
    const name = typeof rec.toolName === 'string' && rec.toolName.length > 0
      ? rec.toolName
      : 'tool';
    if (id) toolNames.set(id, name);
    if (id && handlers.onToolStart) {
      handlers.onToolStart(id, name);
    }
    return;
  }
  if (type === 'tool-output-available') {
    const id = typeof rec.toolCallId === 'string' ? rec.toolCallId : '';
    const eventName = typeof rec.toolName === 'string' && rec.toolName.length > 0
      ? rec.toolName
      : undefined;
    const name = eventName ?? toolNames.get(id) ?? 'tool';
    if (id && handlers.onToolDone) {
      handlers.onToolDone(id, name, rec.output ?? rec.result);
    }
    if (id) toolNames.delete(id);
    return;
  }
  if (type === 'text-delta' && typeof rec.delta === 'string') {
    if (handlers.onTextDelta) {
      handlers.onTextDelta(rec.delta);
    }
    return;
  }
  if (type === 'error') {
    const message =
      typeof rec.errorText === 'string' && rec.errorText.trim()
        ? rec.errorText
        : 'El proveedor de IA no está disponible. Reintentá en un momento.';
    if (handlers.onError) {
      handlers.onError(message);
    }
  }
}