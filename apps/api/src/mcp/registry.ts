import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { config, type McpConfig, type McpServerConfig } from '../config.js';

/** OpenAI exige `^[a-zA-Z0-9_-]{1,64}$` en nombres de tools: sin puntos. */
const TOOL_NAMESPACE_SEPARATOR = '__';

export type McpClientEntry = {
  name: string;
  client: MCPClient;
};

export class McpRegistry {
  private mcps: Map<string, McpServerConfig> = new Map();
  private clients: Map<string, MCPClient> = new Map();

  static fromConfig(): McpRegistry {
    return new McpRegistry(config.mcpConfig);
  }

  constructor(mcps: McpConfig) {
    for (const [name, cfg] of Object.entries(mcps)) {
      this.mcps.set(name, cfg);
    }
  }

  /** Un MCP `optional` que no conecta se saltea; uno requerido que falla hace fallar el turno. */
  async connect(accessToken: string, mcpTokens?: Record<string, string>): Promise<void> {
    const names = [...this.mcps.keys()];
    const results = await Promise.allSettled(
      names.map((name) =>
        this.connectOne(this.mcps.get(name)!, mcpTokens?.[name] ?? accessToken),
      ),
    );
    let requiredError: unknown = null;
    results.forEach((result, index) => {
      const name = names[index];
      if (result.status === 'fulfilled') {
        this.clients.set(name, result.value);
        return;
      }
      if (this.mcps.get(name)!.optional) {
        console.warn(`mcp ${name} unavailable, skipped: ${String(result.reason)}`);
        return;
      }
      requiredError ??= result.reason;
    });
    if (requiredError) {
      await this.close();
      throw requiredError;
    }
  }

  async getAllTools(): Promise<Record<string, unknown>> {
    const allTools: Record<string, unknown> = {};
    for (const [name, client] of this.clients) {
      let listed: Record<string, unknown>;
      try {
        listed = await client.tools();
      } catch (error) {
        if (!this.mcps.get(name)!.optional) {
          throw error;
        }
        console.warn(`mcp ${name} tools unavailable, skipped: ${String(error)}`);
        continue;
      }
      for (const [toolName, tool] of Object.entries(listed)) {
        const key = `${name}${TOOL_NAMESPACE_SEPARATOR}${toolName}`;
        allTools[key] = tool;
      }
    }
    return allTools;
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.clients.values()].map((client) =>
        client.close().catch(() => undefined),
      ),
    );
    this.clients.clear();
  }

  get size(): number {
    return this.clients.size;
  }

  private async connectOne(cfg: McpServerConfig, token: string): Promise<MCPClient> {
    const headers: Record<string, string> = { ...cfg.headers };
    if (cfg.auth) {
      headers.Authorization = `Bearer ${token}`;
    }
    return createMCPClient({
      transport: {
        type: 'http',
        url: cfg.url,
        headers,
      },
      clientName: 'agent-runtime',
    });
  }
}