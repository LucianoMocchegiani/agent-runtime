import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { config, type McpConfig, type McpServerConfig } from '../config.js';

const TOOL_NAMESPACE_SEPARATOR = '__';
export type McpClientEntry = { name: string; client: MCPClient };
const MCP_OPERATION_TIMEOUT_MS = 15_000;
const MCP_CLOSE_TIMEOUT_MS = 1_000;

/** Administra las conexiones MCP y las herramientas con namespace de un turno. */
export class McpRegistry {
  private mcps = new Map<string, McpServerConfig>();
  private clients = new Map<string, MCPClient>();
  private userOnlyTools = new Map<string, { server: string; name: string }>();

  constructor(mcps: McpConfig, private readonly createClient: typeof createMCPClient = createMCPClient) {
    for (const [name, cfg] of Object.entries(mcps)) this.mcps.set(name, cfg);
  }

  static fromConfig(): McpRegistry { return new McpRegistry(config.mcpConfig); }

  async connect(accessToken: string, mcpTokens?: Record<string, string>, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const names = [...this.mcps.keys()];
    const results = await Promise.allSettled(names.map((name) => {
      const cfg = this.mcps.get(name)!;
      const token = cfg.oauth ? (mcpTokens?.[name] ?? '') : (mcpTokens?.[name] ?? accessToken);
      return this.connectOne(cfg, token, signal);
    }));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status === 'fulfilled') this.clients.set(names[index], result.value);
    }
    if (signal?.aborted) { await this.close(); signal.throwIfAborted(); }
    let requiredError: unknown = null;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') return;
      const name = names[index];
      if (this.mcps.get(name)!.optional) console.warn(`mcp ${name} unavailable, skipped: ${String(result.reason)}`);
      else requiredError ??= result.reason;
    });
    if (requiredError) { await this.close(); throw requiredError; }
  }

  async getAllTools(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const allTools: Record<string, unknown> = {};
    for (const [name, client] of this.clients) {
      signal?.throwIfAborted();
      try {
        let definitions = await client.listTools({ options: { signal, timeout: MCP_OPERATION_TIMEOUT_MS } });
        const tools = [...definitions.tools];
        while (definitions.nextCursor != null) {
          signal?.throwIfAborted();
          definitions = await client.listTools({ params: { cursor: definitions.nextCursor }, options: { signal, timeout: MCP_OPERATION_TIMEOUT_MS } });
          tools.push(...definitions.tools);
        }
        const listed = client.toolsFromDefinitions({ ...definitions, tools }) as Record<string, unknown>;
        for (const definition of tools) {
          if (definition._meta?.['chat/userOnly'] === true) {
            this.userOnlyTools.set(`${name}${TOOL_NAMESPACE_SEPARATOR}${definition.name}`, { server: name, name: definition.name });
          }
        }
        for (const [toolName, tool] of Object.entries(listed)) allTools[`${name}${TOOL_NAMESPACE_SEPARATOR}${toolName}`] = tool;
      } catch (error) {
        if (signal?.aborted) signal.throwIfAborted();
        if (!this.mcps.get(name)!.optional) throw error;
        console.warn(`mcp ${name} tools unavailable, skipped: ${String(error)}`);
      }
    }
    return allTools;
  }

  userOnlyToolNames(): ReadonlySet<string> { return new Set(this.userOnlyTools.keys()); }
  isUserOnlyTool(name: string): boolean { return this.userOnlyTools.has(name); }

  async callUserOnlyTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const definition = this.userOnlyTools.get(name);
    const client = definition && this.clients.get(definition.server);
    if (!definition || !client) throw new Error('Tool is not marked chat/userOnly or its MCP server is unavailable');
    return client.callTool({ name: definition.name, arguments: args, options: { signal, timeout: MCP_OPERATION_TIMEOUT_MS } });
  }

  async close(): Promise<void> {
    const closing = Promise.all([...this.clients.values()].map((client) => client.close().catch(() => undefined)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([closing, new Promise<void>((resolve) => { timer = setTimeout(resolve, MCP_CLOSE_TIMEOUT_MS); })]); }
    finally {
      if (timer) clearTimeout(timer);
      this.clients.clear();
      this.userOnlyTools.clear();
    }
  }

  get size(): number { return this.clients.size; }

  private async connectOne(cfg: McpServerConfig, token: string, signal?: AbortSignal): Promise<MCPClient> {
    const headers: Record<string, string> = { ...cfg.headers };
    if (cfg.oauth && !token) throw new Error(`MCP ${cfg.url} requires a user OAuth connection`);
    if (cfg.auth || cfg.oauth) headers.Authorization = `Bearer ${token}`;
    return this.createClient({
      transport: { type: 'http', url: cfg.url, headers },
      initializationOptions: { signal, timeout: MCP_OPERATION_TIMEOUT_MS },
      clientName: 'agent-runtime',
    });
  }
}
