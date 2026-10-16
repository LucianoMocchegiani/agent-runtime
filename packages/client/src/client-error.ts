/** Error HTTP del cliente; `status` conserva el código de respuesta recibido. */
export class ClientError extends Error {
  /** Código HTTP de la respuesta que originó el error. */
  readonly status: number;

  /** @param status Código HTTP recibido.
   * @param message Mensaje de error devuelto por el servidor o por el cliente.
   */
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ClientError';
  }
}
