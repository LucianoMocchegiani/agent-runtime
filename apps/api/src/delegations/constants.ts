/** Duración de la reserva que permite a un worker procesar una delegación. */
export const DELEGATION_LEASE_MS = 120_000;

/** Frecuencia con la que el worker renueva su reserva durante la ejecución. */
export const DELEGATION_RENEW_INTERVAL_MS = 30_000;

/** Demora antes de volver a intentar un trabajo cuando no se pudo tomar su turno. */
export const DELEGATION_RETRY_DELAY_MS = 2_000;

/** Pausa entre consultas del worker cuando la cola no tiene trabajo disponible. */
export const DELEGATION_WORKER_POLL_INTERVAL_MS = 1_000;

/** Frecuencia de los comentarios keep-alive del stream SSE. */
export const DELEGATION_SSE_HEARTBEAT_MS = 15_000;

/** Cantidad máxima de delegaciones expuestas en una consulta de listado. */
export const DELEGATION_LIST_LIMIT = 100;

/** Cantidad máxima de eventos leídos en una consulta del stream SSE. */
export const DELEGATION_EVENT_BATCH_LIMIT = 100;

/** Patrón de validación para identificadores UUID de delegación y conversación. */
export const DELEGATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Patrón para cursores decimales de eventos SSE persistidos como bigint. */
export const DELEGATION_CURSOR_PATTERN = /^\d{1,18}$/;

/** Estados terminales después de los cuales el stream SSE puede cerrarse. */
export const DELEGATION_TERMINAL_STATUSES = ['completed', 'failed', 'interrupted'] as const;

/** Longitud máxima permitida para una instrucción que se delega a otro hilo. */
export const DELEGATION_INSTRUCTION_MAX_LENGTH = 100_000;
