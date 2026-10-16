/** Configuración y límites propios del dominio de preferencias. */
/** Puntaje semántico mínimo para incluir una preferencia entre los resultados de búsqueda. */
export const PREFERENCE_MIN_SEMANTIC_SCORE = 0.34;
/** Puntaje textual mínimo para incluir una preferencia como candidata de búsqueda. */
export const PREFERENCE_MIN_TEXT_SCORE = 0.30;
/** Cantidad de preferencias que recupera por defecto la capa de persistencia al listarlas. */
export const PREFERENCE_LIST_DEFAULT_LIMIT = 100;
/** Máximo de preferencias que la capa de persistencia puede recuperar en una consulta de listado. */
export const PREFERENCE_LIST_MAX_TAKE = 101;
/** Cantidad de preferencias que devuelve por defecto la ruta de listado. */
export const PREFERENCE_ROUTE_DEFAULT_LIMIT = 20;
/** Cantidad máxima de preferencias que la ruta permite solicitar en una página. */
export const PREFERENCE_ROUTE_MAX_LIMIT = 20;
/** Cantidad de preferencias que devuelve por defecto una búsqueda para el contexto del agente. */
export const PREFERENCE_SEARCH_DEFAULT_LIMIT = 5;
/** Cantidad máxima de preferencias que puede devolver una búsqueda para el contexto del agente. */
export const PREFERENCE_SEARCH_MAX_LIMIT = 10;
/** Identificador de ámbito incluido en los cursores para evitar confundirlos con otros dominios. */
export const PREFERENCE_CURSOR_SCOPE = 'preferences';
