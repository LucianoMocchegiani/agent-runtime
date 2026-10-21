/** Configuración HTTP del cliente y proveedores dinámicos de credenciales. */
export type ClientConfig = {
  /** URL base del runtime, con o sin barra final. */
  baseUrl: string;
  /**
   * Devuelve el Bearer de la solicitud actual. Se consulta en cada petición para
   * permitir renovar o cambiar la identidad sin reconstruir el cliente.
   */
  getBearer: () => string | null;
  /** Devuelve las credenciales MCP que se enviarán en `X-MCP-Auth`, si las hay. */
  getMcpAuth?: () => Record<string, string> | null;
};

/** Página de resultados con metadatos para continuar la paginación. */
export type CursorPage<T, Cursor = string> = {
  /** Elementos de esta página. */
  items: T[];
  /** Indica que el servidor dispone de más resultados. */
  hasMore: boolean;
  /** Cursor que debe enviarse para solicitar la página siguiente. */
  nextCursor: Cursor | null;
};

/** Opciones comunes para solicitar una página con cursor. */
export type CursorPageOptions = {
  /** Cantidad máxima de elementos solicitada al servidor. */
  limit?: number;
  /** Cursor devuelto por una página anterior. */
  cursor?: string;
};

/** DTO de conversación que devuelve la API. Las fechas se serializan como texto. */
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
export type AgentProfileInfo = { id: string; name: string; model: { chat: string; realtime?: string } };

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

/** Evento recibido del stream recuperable de una delegación. */
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

/** Cursor de paginación de mensajes, ordenado por fecha e identificador. */
export type MessageCursor = { createdAt: string; id: string };
/** Página de mensajes con cursor de continuación. */
export type MessagePage = CursorPage<Message, MessageCursor>;
/** Opciones de paginación para listar mensajes de un hilo. */
export type MessageListOptions = { limit?: number; before?: MessageCursor };

/** Datos de presentación y selección de un modelo habilitado. */
export type ModelInfo = {
  /** Identificador `proveedor/modelo`; se envía como `model` en `messages.send`. */
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
};

/** Catálogo de modelos junto al modelo predeterminado para chats nuevos. */
export type ModelList = { default: string; items: ModelInfo[] };

/** Adjuntos opcionales enviados con el mensaje actual. */
export type SendOptions = {
  /** Data URLs temporales de imágenes; el servidor no las persiste. */
  images?: string[];
  /** Compatibilidad con clientes antiguos que envían una sola imagen. */
  image?: string | null;
};

/** Callbacks invocados al consumir eventos de texto, herramientas, error y fin. */
export type StreamHandlers = {
  /** Recibe fragmentos de texto a medida que llegan; no incluye el texto completo. */
  onTextDelta?: (delta: string) => void;
  /** Se invoca al comenzar una llamada de herramienta. */
  onToolStart?: (toolCallId: string, toolName: string) => void;
  /** Se invoca al llegar la salida de una herramienta. */
  onToolDone?: (toolCallId: string, toolName: string, output?: unknown) => void;
  /** Recibe errores comunicados dentro del stream. */
  onError?: (message: string) => void;
  /** Se invoca cuando el stream termina correctamente. */
  onFinish?: () => void;
};
