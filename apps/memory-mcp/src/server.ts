import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { MEMORY_TOOLS, type JsonValue } from 'agent-runtime-memory-contract';
import { z } from 'zod/v4';
import { searchMemory } from './search/service.js';
import { deletePreference, listPreferences, savePreference, searchPreferences } from './preferences.js';
import {
  getContext,
  saveSummary,
  saveMessage,
  listMessages,
  listConversations,
  createConversation,
  getConversation,
  updateConversation,
  archiveConversation,
  applyAutomaticTitle,
} from './tools.js';

function registerTools(server: McpServer): void {
  server.registerTool(
    MEMORY_TOOLS.getContext,
    {
      title: 'Get Context',
      description: 'Recupera el contexto de una conversación para el agente.',
      inputSchema: z.object({
        conversationId: z.string(),
        userId: z.string(),
        task: z.string().optional(),
      }),
    },
    async (args) => {
      const result = await getContext({
        conversationId: args.conversationId,
        userId: args.userId,
        task: args.task,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.saveSummary,
    {
      title: 'Save Conversation Summary',
      description: 'Guarda de forma versionada el resumen acumulado y su cursor de mensajes.',
      inputSchema: z.object({
        conversationId: z.string().uuid(),
        userId: z.string(),
        summary: z.string().min(1),
        throughMessageId: z.string().uuid(),
        throughCreatedAt: z.string().datetime(),
        expectedRevision: z.number().int().min(0),
      }),
    },
    async (args) => {
      const saved = await saveSummary(args);
      return { content: [{ type: 'text', text: JSON.stringify(saved) }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.saveMessage,
    {
      title: 'Save Message',
      description: 'Guarda un mensaje en una conversación.',
      inputSchema: z.object({
        conversationId: z.string(),
        userId: z.string(),
        role: z.enum(['user', 'assistant', 'tool']),
        content: z.string(),
        toolName: z.string().nullish(),
        toolArgs: z.record(z.string(), z.unknown()).nullish(),
        toolResult: z.record(z.string(), z.unknown()).nullish(),
      }),
    },
    async (args) => {
      await saveMessage({
        conversationId: args.conversationId,
        userId: args.userId,
        role: args.role,
        content: args.content,
        toolName: args.toolName,
        toolArgs: args.toolArgs as JsonValue | null,
        toolResult: args.toolResult as JsonValue | null,
      });
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.listMessages,
    {
      title: 'List Messages',
      description: 'Lista los mensajes de una conversación.',
      inputSchema: z.object({
        conversationId: z.string(),
        userId: z.string(),
      }),
    },
    async (args) => {
      const rows = await listMessages({
        conversationId: args.conversationId,
        userId: args.userId,
      });
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.listConversations,
    {
      title: 'List Conversations',
      description: 'Lista las conversaciones de un usuario.',
      inputSchema: z.object({
        userId: z.string(),
        archived: z.boolean().optional(),
      }),
    },
    async (args) => {
      const rows = await listConversations({
        userId: args.userId,
        archived: args.archived,
      });
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.createConversation,
    {
      title: 'Create Conversation',
      description: 'Crea una nueva conversación.',
      inputSchema: z.object({
        userId: z.string(),
        title: z.string().nullish(),
      }),
    },
    async (args) => {
      const row = await createConversation({
        userId: args.userId,
        title: args.title ?? null,
      });
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.getConversation,
    {
      title: 'Get Conversation',
      description: 'Obtiene una conversación por ID.',
      inputSchema: z.object({
        id: z.string(),
        userId: z.string(),
      }),
    },
    async (args) => {
      const row = await getConversation({
        id: args.id,
        userId: args.userId,
      });
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.updateConversation,
    {
      title: 'Update Conversation',
      description: 'Actualiza una conversación.',
      inputSchema: z.object({
        id: z.string(),
        userId: z.string(),
        title: z.string().nullish(),
        archived: z.boolean().optional(),
      }),
    },
    async (args) => {
      const row =       await updateConversation({
        id: args.id,
        userId: args.userId,
        patch: {
          title: args.title,
          archived: args.archived,
        },
      });
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.archiveConversation,
    {
      title: 'Archive Conversation',
      description: 'Archiva una conversación.',
      inputSchema: z.object({
        id: z.string(),
        userId: z.string(),
      }),
    },
    async (args) => {
      const row =       await archiveConversation({
        id: args.id,
        userId: args.userId,
      });
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.applyAutomaticTitle,
    {
      title: 'Apply Automatic Title',
      description: 'Asigna título automático a una conversación sin título.',
      inputSchema: z.object({
        conversationId: z.string(),
        userId: z.string(),
        userText: z.string(),
      }),
    },
    async (args) => {
      const title = await applyAutomaticTitle({
        conversationId: args.conversationId,
        userId: args.userId,
        userText: args.userText,
      });
      return { content: [{ type: 'text', text: JSON.stringify(title) }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.searchMemory,
    {
      title: 'Search Memory',
      description: 'Busca recuerdos relevantes en los mensajes del usuario.',
      inputSchema: z.object({
        userId: z.string(),
        query: z.string(),
        conversationId: z.string().optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
    },
    async (args) => {
      const result = await searchMemory({
        userId: args.userId,
        query: args.query,
        conversationId: args.conversationId,
        limit: args.limit,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.savePreference,
    {
      title: 'Save User Preference',
      description: 'Guarda una preferencia explícita del usuario y la condición en la que debe aplicarse.',
      inputSchema: z.object({
        userId: z.string().min(1),
        preference: z.string().min(1).max(2_000),
        activationCondition: z.string().min(1).max(1_000),
        category: z.string().max(100).nullish(),
      }),
    },
    async (args) => {
      const row = await savePreference(args);
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.listPreferences,
    {
      title: 'List User Preferences',
      description: 'Lista las preferencias guardadas del usuario autenticado.',
      inputSchema: z.object({
        userId: z.string().min(1),
      }),
    },
    async (args) => {
      const rows = await listPreferences(args);
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.searchPreferences,
    {
      title: 'Search User Preferences',
      description: 'Encuentra preferencias guardadas del usuario aplicables a un objetivo.',
      inputSchema: z.object({
        userId: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(10).optional(),
      }),
    },
    async (args) => {
      const rows = await searchPreferences(args);
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    },
  );

  server.registerTool(
    MEMORY_TOOLS.deletePreference,
    {
      title: 'Delete User Preference',
      description: 'Elimina permanentemente una preferencia del usuario por su ID.',
      inputSchema: z.object({
        userId: z.string().min(1),
        id: z.string().uuid(),
      }),
    },
    async (args) => {
      const deleted = await deletePreference(args);
      return { content: [{ type: 'text', text: JSON.stringify(deleted) }] };
    },
  );
}

export async function createMemoryMcpServer(): Promise<McpServer> {
  const server = new McpServer({
    name: 'memory-mcp',
    version: '1.0.0',
  });
  registerTools(server);
  return server;
}

/**
 * App HTTP del Memory MCP: `/health` y `/mcp` (stateless, un McpServer por request).
 */
export function createApp(): Hono {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'mcp-session-id',
        'Last-Event-ID',
        'mcp-protocol-version',
      ],
      exposeHeaders: ['mcp-session-id', 'mcp-protocol-version'],
    }),
  );

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.all('/mcp', async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = await createMemoryMcpServer();
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}