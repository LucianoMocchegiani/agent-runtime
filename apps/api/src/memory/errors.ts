/** Error base para fallos al acceder al módulo interno Memory. */
export class MemoryError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'MemoryError';
  }
}

/** Error que indica que Memory no está disponible para atender la operación. */
export class MemoryUnavailableError extends MemoryError {
  constructor(message = 'Memory unavailable') {
    super(message, undefined, 'MEMORY_UNAVAILABLE');
    this.name = 'MemoryUnavailableError';
  }
}
