/** Límites y parámetros de operación del índice y la búsqueda semántica. */
/** Cantidad máxima de documentos que el worker reclama para generar embeddings en un lote. */
export const EMBEDDING_BATCH_SIZE = 16;
/** Cantidad máxima de lotes que procesa el worker durante un ciclo antes de ceder el control. */
export const MAX_EMBEDDING_BATCHES_PER_CYCLE = 8;
/** Intervalo entre ciclos de consulta del worker, en milisegundos. */
export const EMBEDDING_WORKER_POLL_INTERVAL_MS = 2_000;
/** Demora máxima entre reintentos de generación de embeddings, en milisegundos. */
export const EMBEDDING_MAX_RETRY_DELAY_MS = 5 * 60_000;
/** Demora inicial usada para calcular el backoff exponencial de los reintentos, en milisegundos. */
export const EMBEDDING_RETRY_BASE_DELAY_MS = 1_000;
/** Exponente máximo del backoff exponencial para limitar el crecimiento de la demora de reintento. */
export const EMBEDDING_RETRY_MAX_EXPONENT = 8;
/** Parámetro de suavizado k del Reciprocal Rank Fusion usado al combinar resultados de búsqueda. */
export const HYBRID_SEARCH_RRF_K = 60;
/** Cantidad de resultados que devuelve por defecto la búsqueda de memoria. */
export const MEMORY_SEARCH_DEFAULT_LIMIT = 8;
/** Cantidad máxima de resultados que puede devolver una búsqueda de memoria. */
export const MEMORY_SEARCH_MAX_LIMIT = 20;
/** Longitud máxima, en caracteres, del texto enviado a generar un embedding. */
export const MAX_EMBEDDING_INPUT_CHARS = 4_000;
/** Cantidad de dimensiones que deben tener los vectores generados por el modelo de embeddings. */
export const EMBEDDING_VECTOR_DIMENSIONS = 1536;
/** Intervalo mínimo entre advertencias del worker sobre errores repetidos, en milisegundos. */
export const EMBEDDING_WORKER_WARNING_INTERVAL_MS = 30_000;
