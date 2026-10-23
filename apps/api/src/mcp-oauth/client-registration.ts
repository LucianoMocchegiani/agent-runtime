import type { McpOAuthConfig, McpServerConfig } from '../config.js';
import { getOrRegisterOAuthClient } from './persistence.js';
import { registerDynamicOAuthClient, type OAuthMetadata } from './oauth-client.js';

/** Obtiene el cliente OAuth efectivo; el registro dinámico se reutiliza entre usuarios y réplicas. */
export async function resolveOAuthClient(
  name: string,
  mcp: McpServerConfig,
  metadata: OAuthMetadata,
  redirectUri: string,
): Promise<{ metadata: OAuthMetadata; client: McpOAuthConfig }> {
  if (mcp.oauth?.registration !== 'dynamic') return { metadata, client: mcp.oauth! };
  const registered = await getOrRegisterOAuthClient(name, metadata.issuer, redirectUri, () => registerDynamicOAuthClient(metadata, redirectUri));
  return {
    metadata: { ...metadata, tokenEndpointAuthMethod: registered.tokenEndpointAuthMethod },
    client: {
      clientId: registered.clientId,
      ...(registered.clientSecret ? { clientSecret: registered.clientSecret } : {}),
      scopes: mcp.oauth.scopes,
    },
  };
}
