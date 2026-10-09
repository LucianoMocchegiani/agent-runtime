import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { config } from '../config.js';
import {
  MEMORY_TOOLS as TOOL_NAMES,
  type ListConversationsParams,
  type MemoryMcp,
  type GetContextParams,
  type GetContextResult,
  type SaveMessageParams,
  type SaveSummaryParams,
  type CreateConversationParams,
  type ConversationDto,
  type UpdateConversationPatch,
  type MessageDto,
  type ListMessagesParams,
  type GetConversationParams,
  type UpdateConversationParams,
  type ArchiveConversationParams,
  type ApplyTitleParams,
  type MemorySearchParams,
  type MemorySearchResult,
} from 'agent-runtime-memory-contract';
import { MemoryError, MemoryUnavailableError } from './errors.js';

type McpToolExecutor = {
  execute: (input: unknown, options?: unknown) => PromiseLike<unknown>;
};

export async function createMemoryMcpClient(): Promise<MemoryMcp> {
  let mcp: MCPClient;
  try {
    mcp = await createMCPClient({
      transport: {
        type: 'http',
        url: config.memoryMcpUrl,
      },
      clientName: 'agent-runtime',
    });
  } catch (error) {
    throw new MemoryUnavailableError(
      `Memory MCP inaccessible: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let tools: Record<string, McpToolExecutor>;
  try {
    const toolSet = await mcp.tools();
    tools = toolSet as unknown as Record<string, McpToolExecutor>;
  } catch (error) {
    await mcp.close().catch(() => undefined);
    throw new MemoryUnavailableError(
      `Memory MCP tools unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const [, name] of Object.entries(TOOL_NAMES)) {
    if (!tools[name]) {
      await mcp.close().catch(() => undefined);
      throw new MemoryError(
        `Memory MCP no expone la herramienta requerida: ${name}`,
      );
    }
  }

  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    await mcp.close().catch(() => undefined);
  }

  async function callTool<T>(name: string, input: unknown): Promise<T> {
    try {
      const result = await tools[name].execute(input, { throwOnError: true });
      const text =
        typeof result === 'object' &&
        result !== null &&
        'content' in result
          ? (result as { content: Array<{ type: string; text: string }> })
              .content?.[0]?.text
          : String(result);
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } catch (error) {
      if (error instanceof MemoryError) throw error;
      throw new MemoryError(
        `Memory MCP error en ${name}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  return {
    async getContext(params: GetContextParams): Promise<GetContextResult> {
      return callTool<GetContextResult>(TOOL_NAMES.getContext, params);
    },
    async saveSummary(params: SaveSummaryParams): Promise<boolean> {
      return callTool<boolean>(TOOL_NAMES.saveSummary, params);
    },
    async saveMessage(params: SaveMessageParams): Promise<void> {
      await callTool<void>(TOOL_NAMES.saveMessage, params);
    },
    async listMessages(params: ListMessagesParams): Promise<MessageDto[]> {
      return callTool<MessageDto[]>(TOOL_NAMES.listMessages, params);
    },
    async listConversations(
      params: ListConversationsParams,
    ): Promise<ConversationDto[]> {
      return callTool<ConversationDto[]>(TOOL_NAMES.listConversations, params);
    },
    async createConversation(
      params: CreateConversationParams,
    ): Promise<ConversationDto> {
      return callTool<ConversationDto>(TOOL_NAMES.createConversation, params);
    },
    async getConversation(
      params: GetConversationParams,
    ): Promise<ConversationDto> {
      return callTool<ConversationDto>(TOOL_NAMES.getConversation, params);
    },
    async updateConversation(
      params: UpdateConversationParams,
    ): Promise<ConversationDto> {
      return callTool<ConversationDto>(TOOL_NAMES.updateConversation, params);
    },
    async archiveConversation(
      params: ArchiveConversationParams,
    ): Promise<ConversationDto> {
      return callTool<ConversationDto>(TOOL_NAMES.archiveConversation, params);
    },
    async applyAutomaticTitle(
      params: ApplyTitleParams,
    ): Promise<string | null> {
      return callTool<string | null>(TOOL_NAMES.applyAutomaticTitle, params);
    },
    async searchMemory(
      params: MemorySearchParams,
    ): Promise<MemorySearchResult> {
      return callTool<MemorySearchResult>(TOOL_NAMES.searchMemory, params);
    },
    close,
  };
}