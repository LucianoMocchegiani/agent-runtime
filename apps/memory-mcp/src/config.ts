/**
 * Env del Memory MCP default. Independiente del runtime: no necesita AI, auth ni CORS.
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

function parsePort(raw: string | undefined): number {
  if (!raw?.trim()) {
    return 3012;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid MEMORY_MCP_PORT: ${raw}`);
  }
  return port;
}

export type MemoryMcpConfig = {
  databaseUrl: string;
  /** Default 127.0.0.1: sin auth propia, solo accesible desde la misma máquina. La imagen usa 0.0.0.0. */
  host: string;
  port: number;
};

export const config: MemoryMcpConfig = {
  databaseUrl: required('DATABASE_URL'),
  host: process.env.MEMORY_MCP_HOST?.trim() || '127.0.0.1',
  port: parsePort(process.env.MEMORY_MCP_PORT),
};
