/**
 * Identidad resuelta por introspección (contrato portable).
 *
 * @remarks `userId` aísla hilos. Nunca sale del body del cliente.
 */

/** Identidad autenticada que se usa para aislar los datos por usuario. */
export type Principal = {
  userId: string;
  email: string | null;
  name: string | null;
};

/** Variables de contexto Hono establecidas por el middleware de autenticación. */
export type AppEnv = {
  Variables: {
    principal: Principal;
    accessToken: string;
    mcpAuth: Record<string, string> | null;
  };
};