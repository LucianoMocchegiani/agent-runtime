/**
 * Cliente genérico para agent-runtime.
 *
 * Usa el protocolo UI Message Stream (AI SDK).
 * No depende de framework UI.
 */

/** Configuración del cliente HTTP, incluidos proveedores dinámicos de credenciales. */
export type ClientConfig = {
  baseUrl: string;
  getBearer: () => string | null;
  getMcpAuth?: () => Record<string, string> | null;
};

/** Página de resultados con metadatos para continuar la paginación. */
export type CursorPage<T, Cursor = string> = {
  items: T[];
  hasMore: boolean;
  nextCursor: Cursor | null;
};

/** Opciones comunes para solicitar una página con cursor. */
export type CursorPageOptions = { limit?: number; cursor?: string };

/** DTO de conversación que devuelve la API. */
export type Conversation = {
  id: string;
  userId: string;
  title: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  agentProfileId: string | null;
};

/** Campos públicos del perfil de agente disponibles para la aplicación cliente. */
export type AgentProfileInfo = { id: string; name: string; modelId: string };

/** Preferencia persistente devuelta por Memory. */
export type UserPreference = {
  id: string;
  preference: string;
  activationCondition: string;
  category: string | null;
  createdAt: string;
};

/** Campos requeridos para guardar una preferencia. */
export type SavePreferenceOptions = Omit<UserPreference, 'id' | 'createdAt'>;

/** Estados posibles de una tarea delegada. */
export type DelegationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';
/** Estado y metadatos públicos de una delegación. */
export type Delegation = {
  id: string;
  status: DelegationStatus;
  sourceConversationId: string;
  targetConversationId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
};
/** Evento recibido del stream de una delegación. */
export type DelegationEvent = { id: string; type: string; data: unknown; createdAt: string };

/** Mensaje serializado de usuario, asistente o herramienta. */
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

/** Cursor de paginación de mensajes, con fecha e identificador. */
export type MessageCursor = { createdAt: string; id: string };
/** Página de mensajes con cursor de continuación. */
export type MessagePage = CursorPage<Message, MessageCursor>;
/** Opciones de paginación para listar mensajes de un hilo. */
export type MessageListOptions = { limit?: number; before?: MessageCursor };

/** Datos de presentación y selección de un modelo habilitado. */
export type ModelInfo = {
  /** `proveedor/modelo`; se manda como `model` en `messages.send`. */
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
};

/** Catálogo de modelos junto al modelo predeterminado para chats nuevos. */
export type ModelList = {
  default: string;
  items: ModelInfo[];
};

/** Adjuntos opcionales enviados con el mensaje actual. */
export type SendOptions = {
  /** Data URLs temporales de imágenes; el servidor no las persiste. */
  images?: string[];
  /** Compatibilidad con clientes antiguos que envían una sola imagen. */
  image?: string | null;
};

/** Callbacks invocados al consumir eventos de texto, herramientas, error y fin. */
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

/** Error HTTP del cliente; `status` conserva el código de respuesta recibido. */
export class ClientError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ClientError';
  }
}

/**
 * Crea el cliente tipado para conversaciones, mensajes, modelos, voz, preferencias y delegaciones.
 * @param config URL base y callbacks de credenciales consultados en cada solicitud.
 */
export function createClient(config: ClientConfig) {
  function cursorQuery(options: CursorPageOptions & { archived?: boolean } = {}): string {
    const query = new URLSearchParams();
    if (options.archived) query.set('archived', 'true');
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.cursor) query.set('cursor', options.cursor);
    return query.size ? `?${query.toString()}` : '';
  }

  async function fetchConversationPage(
    options: { archived?: boolean } & CursorPageOptions = {},
  ): Promise<CursorPage<Conversation>> {
    const suffix = cursorQuery(options);
    const res = await fetch(`${baseUrl(config)}/v1/conversations${suffix}`, {
      headers: headers(config, { Accept: 'application/json' }),
    });
    if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
    const data = await json<CursorPage<Conversation>>(res);
    return { items: data?.items ?? [], hasMore: data?.hasMore ?? false, nextCursor: data?.nextCursor ?? null };
  }

  async function fetchPreferencePage(options: CursorPageOptions = {}): Promise<CursorPage<UserPreference>> {
    const suffix = cursorQuery(options);
    const res = await fetch(`${baseUrl(config)}/v1/preferences${suffix}`, {
      headers: headers(config, { Accept: 'application/json' }),
    });
    if (!res.ok) throw new ClientError(res.status, `No se pudieron cargar las preferencias (HTTP ${res.status}).`);
    const data = await json<CursorPage<UserPreference>>(res);
    return { items: data?.items ?? [], hasMore: data?.hasMore ?? false, nextCursor: data?.nextCursor ?? null };
  }

  async function streamTurn(
    path: string,
    body: Record<string, unknown>,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<'ok' | 'aborted'> {
    try {
      const res = await fetch(`${baseUrl(config)}${path}`, {
        method: 'POST',
        headers: headers(config, {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        }),
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const parsed = await json<unknown>(res);
        const message = typeof parsed === 'object' && parsed !== null
          ? (parsed as { error?: string; message?: string }).error
            ?? (parsed as { error?: string; message?: string }).message
            ?? `Error HTTP ${res.status}`
          : `Error HTTP ${res.status}`;
        throw new ClientError(res.status, message);
      }
      if (!res.body) throw new ClientError(502, 'El asistente no está disponible.');

      await consumeUiMessageStream(res.body, handlers);
      if (signal?.aborted) return 'aborted';
      handlers.onFinish?.();
      return 'ok';
    } catch (error) {
      if (isAbortError(error)) return 'aborted';
      throw error;
    }
  }

  return {
    /** Operaciones paginadas y CRUD de conversaciones. */
    conversations: {
      /** Recorre páginas hasta 100 conversaciones y devuelve el listado agregado. */
      list: async (options: { archived?: boolean } = {}): Promise<Conversation[]> => {
        const items: Conversation[] = [];
        let cursor: string | undefined;
        do {
          const page = await fetchConversationPage({ ...options, limit: 20, ...(cursor ? { cursor } : {}) });
          items.push(...page.items);
          cursor = page.nextCursor ?? undefined;
          if (!page.hasMore || items.length >= 100) break;
        } while (cursor);
        return items.slice(0, 100);
      },

      /** Solicita una página de conversaciones sin recorrer el resto. */
      listPage: async (options: { archived?: boolean } & CursorPageOptions = {}): Promise<CursorPage<Conversation>> =>
        fetchConversationPage(options),

      /** Crea una conversación, opcionalmente asignándole un perfil inicial. */
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

      /** Consulta una conversación por su identificador. */
      get: async (id: string): Promise<Conversation> => {
        const res = await fetch(`${baseUrl(config)}/v1/conversations/${id}`, {
          headers: headers(config, { Accept: 'application/json' }),
        });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        return json<Conversation>(res);
      },

      /** Archiva una conversación. */
      archive: async (id: string): Promise<Conversation> => {
        const res = await fetch(`${baseUrl(config)}/v1/conversations/${id}`, {
          method: 'DELETE',
          headers: headers(config),
        });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        return json<Conversation>(res);
      },

      /** Actualiza título, archivo o perfil sin modificar los campos omitidos. */
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

    /** Operaciones para listar, guardar y eliminar preferencias persistentes. */
    preferences: {
      /** Recorre páginas hasta 100 preferencias y devuelve el listado agregado. */
      list: async (): Promise<UserPreference[]> => {
        const items: UserPreference[] = [];
        let cursor: string | undefined;
        do {
          const page = await fetchPreferencePage({ limit: 20, ...(cursor ? { cursor } : {}) });
          items.push(...page.items);
          cursor = page.nextCursor ?? undefined;
          if (!page.hasMore || items.length >= 100) break;
        } while (cursor);
        return items.slice(0, 100);
      },

      /** Solicita una página de preferencias sin recorrer el resto. */
      listPage: async (options: CursorPageOptions = {}): Promise<CursorPage<UserPreference>> =>
        fetchPreferencePage(options),

      /** Guarda una preferencia persistente. */
      save: async (preference: SavePreferenceOptions): Promise<UserPreference> => {
        const res = await fetch(`${baseUrl(config)}/v1/preferences`, {
          method: 'POST',
          headers: headers(config, { 'Content-Type': 'application/json', Accept: 'application/json' }),
          body: JSON.stringify(preference),
        });
        if (!res.ok) throw new ClientError(res.status, `No se pudo guardar la preferencia (HTTP ${res.status}).`);
        return json<UserPreference>(res);
      },

      /** Elimina una preferencia por su identificador. */
      delete: async (id: string): Promise<void> => {
        const res = await fetch(`${baseUrl(config)}/v1/preferences/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: headers(config),
        });
        if (!res.ok) throw new ClientError(res.status, `No se pudo borrar la preferencia (HTTP ${res.status}).`);
      },
    },

    /** Catálogo de modelos habilitados y selección predeterminada. */
    models: {
      /** Obtiene el catálogo de modelos habilitados y el predeterminado. */
      list: async (): Promise<ModelList> => {
        const res = await fetch(`${baseUrl(config)}/v1/models`, {
          headers: headers(config, { Accept: 'application/json' }),
        });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        const data = await json<ModelList>(res);
        return { default: data?.default ?? '', items: data?.items ?? [] };
      },
    },

    /** Metadatos de perfiles disponibles en la aplicación autenticada. */
    agentProfiles: {
      /** Lista los metadatos de perfiles disponibles para la aplicación. */
      list: async (): Promise<AgentProfileInfo[]> => {
        const res = await fetch(`${baseUrl(config)}/v1/agent-profiles`, { headers: headers(config, { Accept: 'application/json' }) });
        if (!res.ok) throw new ClientError(res.status, `HTTP ${res.status}`);
        const data = await json<{ items: AgentProfileInfo[] }>(res);
        return data?.items ?? [];
      },
    },

    /** Consulta delegaciones y consume sus eventos persistidos por SSE. */
    delegations: {
      /** Lista delegaciones del usuario autenticado. */
      list: async (): Promise<Delegation[]> => {
        const res = await fetch(`${baseUrl(config)}/v1/delegations`, {
          headers: headers(config, { Accept: 'application/json' }),
        });
        if (!res.ok) throw new ClientError(res.status, `No se pudieron listar las delegaciones (HTTP ${res.status}).`);
        const data = await json<{ items: Delegation[] }>(res);
        return data?.items ?? [];
      },

      /** Consulta el estado de una delegación propia. */
      get: async (id: string): Promise<Delegation> => {
        const res = await fetch(`${baseUrl(config)}/v1/delegations/${encodeURIComponent(id)}`, {
          headers: headers(config, { Accept: 'application/json' }),
        });
        if (!res.ok) throw new ClientError(res.status, `No se pudo consultar la delegación (HTTP ${res.status}).`);
        return json<Delegation>(res);
      },

      /** Sigue los eventos SSE desde el cursor opcional hasta cancelar la señal. */
      events: async (
        id: string,
        options: { after?: string; signal?: AbortSignal; onEvent: (event: DelegationEvent) => void },
      ): Promise<void> => {
        const query = options.after ? `?after=${encodeURIComponent(options.after)}` : '';
        const res = await fetch(`${baseUrl(config)}/v1/delegations/${encodeURIComponent(id)}/events${query}`, {
          headers: headers(config, { Accept: 'text/event-stream' }),
          signal: options.signal,
        });
        if (!res.ok) throw new ClientError(res.status, `No se pudieron cargar los eventos (HTTP ${res.status}).`);
        if (!res.body) throw new ClientError(502, 'El stream de eventos no está disponible.');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let lastId = options.after ?? '';
        const dispatch = (block: string) => {
          let idValue = lastId;
          let eventType = 'message';
          const data: string[] = [];
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('id:')) idValue = line.slice(3).trim();
            else if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
          }
          if (!data.length) return;
          lastId = idValue;
          try {
            options.onEvent({ id: idValue, type: eventType, data: JSON.parse(data.join('\n')), createdAt: new Date().toISOString() });
          } catch {
            // Ignoramos eventos malformados; el estado se puede volver a consultar.
          }
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() ?? '';
            for (const block of blocks) dispatch(block);
          }
          if (buffer.trim()) dispatch(buffer);
        } finally {
          reader.releaseLock();
        }
      },
    },

    /** Consulta disponibilidad de voz y accede a transcripción/síntesis. */
    voice: {
      /** Indica si la síntesis de voz está disponible para el hilo. */
      status: async (conversationId: string): Promise<{ available: boolean }> => {
        const res = await fetch(`${baseUrl(config)}/v1/conversations/${encodeURIComponent(conversationId)}/voice/status`, {
          headers: headers(config, { Accept: 'application/json' }),
        });
        if (!res.ok) throw new ClientError(res.status, `No se pudo consultar la disponibilidad de voz (HTTP ${res.status}).`);
        return json<{ available: boolean }>(res);
      },

      /** Solicita una credencial Realtime temporal para transcripción. */
      createRealtimeToken: async (conversationId: string): Promise<{ value: string; expiresAt: number | null }> => {
        const res = await fetch(`${baseUrl(config)}/v1/conversations/${encodeURIComponent(conversationId)}/voice/token`, {
          method: 'POST',
          headers: headers(config, { Accept: 'application/json' }),
        });
        if (!res.ok) {
          const data = await json<{ error?: string; message?: string }>(res);
          throw new ClientError(res.status, data?.error ?? data?.message ?? `No se pudo iniciar la voz (HTTP ${res.status}).`);
        }
        return json<{ value: string; expiresAt: number | null }>(res);
      },

      /** Convierte texto en audio y devuelve el resultado como `Blob`. */
      synthesize: async (conversationId: string, text: string, traceId?: string): Promise<Blob> => {
        const requestHeaders = headers(config, { 'Content-Type': 'application/json', Accept: 'audio/mpeg' });
        if (traceId) requestHeaders['X-Voice-Trace-Id'] = traceId;
        const res = await fetch(`${baseUrl(config)}/v1/conversations/${encodeURIComponent(conversationId)}/voice/speech`, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const data = await json<{ error?: string; message?: string }>(res);
          throw new ClientError(res.status, data?.error ?? data?.message ?? `No se pudo generar la voz (HTTP ${res.status}).`);
        }
        return res.blob();
      },
    },

    /** Lista mensajes y envía/edita turnos mediante UI Message Stream. */
    messages: {
      /** Obtiene una página de mensajes, opcionalmente antes de un cursor. */
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

      /** Envía un turno y despacha deltas y eventos a los handlers. */
      send: async (
        conversationId: string,
        text: string,
        handlers: StreamHandlers = {},
        signal?: AbortSignal,
        options: SendOptions = {},
      ): Promise<'ok' | 'aborted'> => streamTurn(
        `/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          text,
          ...(options.images?.length ? { images: options.images } : {}),
          ...(!options.images?.length && options.image ? { image: options.image } : {}),
        },
        handlers,
        signal,
      ),

      /** Edita un mensaje del usuario y regenera desde ese punto. */
      edit: async (
        conversationId: string,
        messageId: string,
        text: string,
        expectedLaterMessages: number,
        handlers: StreamHandlers = {},
        signal?: AbortSignal,
      ): Promise<'ok' | 'aborted'> => streamTurn(
        `/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/edit`,
        { text, expectedLaterMessages },
        handlers,
        signal,
      ),
    },
  };
}

/** Indica si el error corresponde a una solicitud cancelada mediante `AbortSignal`. */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/**
 * Consume el stream UI Message de AI SDK y despacha los eventos normalizados.
 * @param body Cuerpo SSE recibido de la API.
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