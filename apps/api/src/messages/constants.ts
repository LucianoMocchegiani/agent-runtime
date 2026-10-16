/** Valores y límites propios del dominio de mensajes. */
/** Roles de mensaje que la aplicación almacena y procesa. */
export const MESSAGE_ROLE = {
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL: 'tool',
} as const;
/** Lista derivada de roles válidos, usada para construir el tipo MessageRole. */
export const MESSAGE_ROLES = [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT, MESSAGE_ROLE.TOOL] as const;
/** Cantidad de mensajes devuelta por defecto al listar mensajes de una conversación. */
export const MESSAGE_LIST_DEFAULT_LIMIT = 50;
/** Cantidad máxima de mensajes que una solicitud de listado puede pedir. */
export const MESSAGE_LIST_MAX_LIMIT = 100;
/** Máximo de mensajes previos que se carga para construir el contexto de una conversación. */
export const MESSAGE_CONTEXT_MAX_TAKE = 500;
/** Longitud máxima, en caracteres, del texto de un mensaje enviado por la API. */
export const MESSAGE_TEXT_MAX_LENGTH = 100_000;
/** Tamaño máximo en bytes de cada imagen adjunta. */
export const MESSAGE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Cantidad máxima de imágenes adjuntas en un solo mensaje. */
export const MESSAGE_MAX_IMAGES = 10;
/** Tipos MIME de imagen aceptados como adjuntos. */
export const SUPPORTED_MESSAGE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
/** Tamaño máximo del cuerpo JSON de una solicitud para enviar un mensaje, incluyendo adjuntos. */
export const MESSAGE_BODY_MAX_BYTES = 72_000_000;
/** Tamaño máximo del cuerpo JSON de una solicitud para editar un mensaje. */
export const MESSAGE_EDIT_BODY_MAX_BYTES = 1_000_000;
/** Máximo de mensajes posteriores que puede declarar el cliente al solicitar una edición. */
export const MESSAGE_EDIT_MAX_LATER_MESSAGES = 10_000;
/** Texto marcador que se agrega cuando un mensaje incluye una imagen que no se almacenó. */
export const UNSAVED_IMAGE_NOTE = '[Imagen adjunta; no almacenada]';
/** Sufijo del marcador usado para indicar cuántas imágenes adjuntas no se almacenaron. */
export const UNSAVED_IMAGES_NOTE_SUFFIX = 'imágenes adjuntas; no almacenadas]';
