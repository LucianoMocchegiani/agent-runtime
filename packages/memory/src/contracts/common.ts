/** Tipos JSON compartidos por los contratos públicos de Memory. */

/** Valor compatible con JSON, usado en argumentos y resultados de herramientas. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
