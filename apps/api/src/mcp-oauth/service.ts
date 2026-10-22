import type { McpConfig } from '../config.js';
import { discoverOAuthMetadata, refreshOAuthToken } from './oauth-client.js';
import { getMcpOAuthTokens, saveMcpOAuthConnection, type StoredOAuthTokens } from './persistence.js';

export async function getMcpOAuthAccessToken(userId: string, name: string, config: McpConfig): Promise<string | null> {
  const mcp = config[name];
  if (!mcp?.oauth) return null;
  const stored = await getMcpOAuthTokens(userId, name);
  if (!stored) return null;
  if (!stored.expiresAt || stored.expiresAt.getTime() > Date.now() + 30_000) return stored.accessToken;
  if (!stored.refreshToken) return null;
  try {
    const metadata = await discoverOAuthMetadata(mcp);
    const refreshed = await refreshOAuthToken(metadata, mcp.oauth, stored.refreshToken);
    const tokens: StoredOAuthTokens = { ...refreshed };
    await saveMcpOAuthConnection({ userId, mcpName: name, account: null, tokens });
    return tokens.accessToken;
  } catch (error) {
    console.warn(`OAuth refresh failed for MCP ${name}:`, error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

