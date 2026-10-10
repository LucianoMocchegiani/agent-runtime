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

export class MemoryUnavailableError extends MemoryError {
  constructor(message = 'Memory unavailable') {
    super(message, undefined, 'MEMORY_UNAVAILABLE');
    this.name = 'MemoryUnavailableError';
  }
}
