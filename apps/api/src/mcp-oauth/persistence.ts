import { createHash } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { openOAuthToken, sealOAuthToken } from './crypto.js';
import type { RegisteredOAuthClient } from './oauth-client.js';

export type OAuthState = { userId: string; mcpName: string; codeVerifier: string };
export type StoredOAuthTokens = { accessToken: string; refreshToken: string | null; tokenType: string; expiresAt: Date | null };

export async function createOAuthState(state: string, userId: string, mcpName: string, codeVerifier: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO runtime.mcp_oauth_states (state_hash, user_id, mcp_name, code_verifier, expires_at)
    VALUES (${hashState(state)}, ${userId}, ${mcpName}, ${codeVerifier}, clock_timestamp() + interval '10 minutes')
  `;
  await prisma.$executeRaw`DELETE FROM runtime.mcp_oauth_states WHERE expires_at <= clock_timestamp()`;
}

/** Consume de forma atómica el estado para evitar replay y devolver identidad/MCP del flujo. */
export async function consumeOAuthState(state: string): Promise<OAuthState | null> {
  const rows = await prisma.$queryRaw<OAuthState[]>`
    DELETE FROM runtime.mcp_oauth_states
    WHERE state_hash = ${hashState(state)} AND expires_at > clock_timestamp()
    RETURNING user_id AS "userId", mcp_name AS "mcpName", code_verifier AS "codeVerifier"
  `;
  return rows[0] ?? null;
}

function hashState(state: string): string { return createHash('sha256').update(state).digest('hex'); }

export async function saveMcpOAuthConnection(params: {
  userId: string; mcpName: string; account: string | null; tokens: StoredOAuthTokens;
}): Promise<void> {
  const sealed = sealOAuthToken(JSON.stringify(params.tokens));
  await prisma.$executeRaw`
    INSERT INTO runtime.mcp_oauth_connections
      (user_id, mcp_name, account_login, token_ciphertext, token_nonce, token_tag, expires_at, updated_at)
    VALUES
      (${params.userId}, ${params.mcpName}, ${params.account}, ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.tag}, ${params.tokens.expiresAt}, clock_timestamp())
    ON CONFLICT (user_id, mcp_name) DO UPDATE SET
      account_login = EXCLUDED.account_login, token_ciphertext = EXCLUDED.token_ciphertext,
      token_nonce = EXCLUDED.token_nonce, token_tag = EXCLUDED.token_tag,
      expires_at = EXCLUDED.expires_at, updated_at = clock_timestamp()
  `;
}

export async function getMcpOAuthConnection(userId: string, mcpName: string): Promise<{ account: string | null; expiresAt: Date | null } | null> {
  const rows = await prisma.$queryRaw<Array<{ account: string | null; expiresAt: Date | null }>>`
    SELECT account_login AS "account", expires_at AS "expiresAt"
    FROM runtime.mcp_oauth_connections WHERE user_id = ${userId} AND mcp_name = ${mcpName}
  `;
  return rows[0] ?? null;
}

export async function getMcpOAuthTokens(userId: string, mcpName: string): Promise<StoredOAuthTokens | null> {
  const rows = await prisma.$queryRaw<Array<{ ciphertext: Buffer; nonce: Buffer; tag: Buffer }>>`
    SELECT token_ciphertext AS "ciphertext", token_nonce AS "nonce", token_tag AS "tag"
    FROM runtime.mcp_oauth_connections WHERE user_id = ${userId} AND mcp_name = ${mcpName}
  `;
  const row = rows[0];
  if (!row) return null;
  try {
    const parsed = JSON.parse(openOAuthToken(row)) as Partial<StoredOAuthTokens> & { expiresAt?: string | Date | null };
    if (typeof parsed.accessToken !== 'string' || typeof parsed.tokenType !== 'string') return null;
    const expiresAt = parsed.expiresAt ? new Date(parsed.expiresAt) : null;
    if (expiresAt && !Number.isFinite(expiresAt.getTime())) return null;
    return { accessToken: parsed.accessToken, refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null, tokenType: parsed.tokenType, expiresAt };
  } catch { return null; }
}

export async function deleteMcpOAuthConnection(userId: string, mcpName: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM runtime.mcp_oauth_connections WHERE user_id = ${userId} AND mcp_name = ${mcpName}`;
}

/** Serializa DCR entre réplicas: una única instancia registra por nombre de MCP e issuer. */
export async function getOrRegisterOAuthClient(
  mcpName: string,
  issuer: string,
  redirectUri: string,
  register: () => Promise<RegisteredOAuthClient>,
): Promise<RegisteredOAuthClient> {
  return prisma.$transaction(async (tx) => {
    const lockKey = `${mcpName}\n${issuer}`;
    // pg_advisory_xact_lock returns PostgreSQL `void`, which Prisma cannot deserialize.
    // Cast it to a supported scalar type; the lock remains held until this transaction ends.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS lock_acquired`;
    const rows = await tx.$queryRaw<Array<{ ciphertext: Buffer; nonce: Buffer; tag: Buffer }>>`
      SELECT client_ciphertext AS "ciphertext", client_nonce AS "nonce", client_tag AS "tag"
      FROM runtime.mcp_oauth_clients WHERE mcp_name = ${mcpName} AND issuer = ${issuer}
    `;
    const row = rows[0];
    if (row) {
      try {
        const saved = JSON.parse(openOAuthToken(row)) as Partial<RegisteredOAuthClient> & { expiresAt?: string | Date | null; redirectUri?: string };
        const expiresAt = saved.expiresAt ? new Date(saved.expiresAt) : null;
        if (saved.redirectUri === redirectUri && typeof saved.clientId === 'string' && saved.clientId &&
          (saved.tokenEndpointAuthMethod === 'none' || saved.tokenEndpointAuthMethod === 'client_secret_basic' || saved.tokenEndpointAuthMethod === 'client_secret_post') &&
          (!saved.clientSecret || typeof saved.clientSecret === 'string') &&
          (!expiresAt || (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > Date.now()))) {
          return {
            clientId: saved.clientId,
            ...(saved.clientSecret ? { clientSecret: saved.clientSecret } : {}),
            tokenEndpointAuthMethod: saved.tokenEndpointAuthMethod,
            expiresAt,
          };
        }
      } catch { /* Replace invalid ciphertext or expired registration below. */ }
    }

    const registered = await register();
    const sealed = sealOAuthToken(JSON.stringify({ ...registered, redirectUri }));
    await tx.$executeRaw`
      INSERT INTO runtime.mcp_oauth_clients
        (mcp_name, issuer, client_ciphertext, client_nonce, client_tag, updated_at)
      VALUES (${mcpName}, ${issuer}, ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.tag}, clock_timestamp())
      ON CONFLICT (mcp_name, issuer) DO UPDATE SET
        client_ciphertext = EXCLUDED.client_ciphertext, client_nonce = EXCLUDED.client_nonce,
        client_tag = EXCLUDED.client_tag, updated_at = clock_timestamp()
    `;
    return registered;
  }, { maxWait: 10_000, timeout: 30_000 });
}
