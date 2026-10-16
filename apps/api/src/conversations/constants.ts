/** Reglas y límites de dominio para conversaciones. */
/** Longitud máxima permitida para un título de conversación definido por el usuario. */
export const CONVERSATION_TITLE_MAX_LENGTH = 200;
/** Longitud máxima de los títulos generados automáticamente a partir del primer mensaje. */
export const AUTO_CONVERSATION_TITLE_MAX_LENGTH = 60;
/** Cantidad de conversaciones que devuelve la ruta cuando no se especifica un límite. */
export const CONVERSATION_LIST_DEFAULT_LIMIT = 20;
/** Cantidad máxima de conversaciones que la ruta permite solicitar en una página. */
export const CONVERSATION_LIST_MAX_LIMIT = 20;
/** Tope de registros que la capa de persistencia puede recuperar en una consulta de conversaciones. */
export const CONVERSATION_PERSISTENCE_MAX_TAKE = 100;
/** Tenant usado al crear conversaciones cuando no se proporciona uno explícitamente. */
export const DEFAULT_CONVERSATION_TENANT_ID = 'public';
/** Título inicial asignado a una conversación sin título propio. */
export const DEFAULT_CONVERSATION_TITLE = 'Nuevo chat';
/** Valores válidos del filtro que distingue conversaciones activas, archivadas o de todos los estados. */
export const CONVERSATION_LIST_SCOPE = {
  ALL: 'all',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;
