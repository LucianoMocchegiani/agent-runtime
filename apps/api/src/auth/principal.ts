/**
 * Identidad resuelta por introspección (contrato portable, no GymBro).
 *
 * @remarks `userId` aísla hilos. Nunca sale del body del cliente.
 */

export type Principal = {
  userId: string;
  email: string | null;
  name: string | null;
};

export type AppEnv = {
  Variables: {
    principal: Principal;
    accessToken: string;
    mcpAuth: Record<string, string> | null;
  };
};