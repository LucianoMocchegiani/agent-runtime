import { jsonSchema, tool, type Tool } from 'ai';
import type { MemoryService } from 'agent-runtime-memory-contract';
import type { Principal } from '../auth/principal.js';
import { createConversation, getConversation } from '../conversations/service.js';
import { enqueueDelegation, getDelegationForUser } from '../delegations/store.js';
import { getNewChatDefaultAgentProfile } from '../runtime-config/agent-profiles.js';
import { decodeOptionalConversationCursor, encodeConversationCursor, type ConversationListScope } from './conversation-cursor.js';

type AgentToolContext = {
  memory: MemoryService;
  principal: Principal;
  conversationId: string;
  accessToken: string;
  mcpTokens?: Record<string, string>;
  delegationEnabled: boolean;
};

export class AgentToolNameConflictError extends Error {
  constructor() {
    super('An MCP tool conflicts with a reserved agent tool name.');
    this.name = 'AgentToolNameConflictError';
  }
}

export function buildAgentTools(
  mcpTools: Record<string, Tool>,
  context: AgentToolContext,
): Record<string, Tool> {
  const { memory, principal, conversationId, accessToken, mcpTokens, delegationEnabled } = context;
  const tools = { ...mcpTools };
  const conversationToolNames = ['list_conversations', 'create_conversation'];
  if (conversationToolNames.some((name) => Object.hasOwn(tools, name))) {
    throw new AgentToolNameConflictError();
  }
  tools.list_conversations = tool({
    description: 'Lista las conversaciones del usuario autenticado en páginas de hasta 20, ordenadas por actividad reciente. Por defecto incluye activas y archivadas. Usa el cursor devuelto para avanzar; no vuelvas a empezar desde la primera página. Devuelve solo metadatos, no mensajes.',
    inputSchema: jsonSchema<{
      scope?: ConversationListScope;
      cursor?: string;
    }>({
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['all', 'active', 'archived'],
          description: 'Qué conversaciones incluir. Por defecto all.',
        },
        cursor: {
          type: 'string',
          maxLength: 500,
          description: 'Cursor nextCursor de la página anterior. Omitir para comenzar.',
        },
      },
      additionalProperties: false,
    }),
    execute: async ({ scope = 'all', cursor }) => {
      console.info('tool list_conversations invoked');
      let before: { updatedAt: string; id: string } | undefined;
      try {
        before = decodeOptionalConversationCursor(cursor, scope);
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'El cursor no es válido.' };
      }
      const page = await memory.listConversations({
        userId: principal.userId,
        ...(scope === 'all' ? {} : { archived: scope === 'archived' }),
        limit: 21,
        ...(before ? { before } : {}),
      });
      const items = page.slice(0, 20);
      const hasMore = page.length > 20;
      const last = items.at(-1);
      return {
        items: items.map(({ id, title, updatedAt, archivedAt }) => ({
          id,
          title,
          updatedAt,
          archived: archivedAt !== null,
        })),
        hasMore,
        nextCursor: hasMore && last
          ? encodeConversationCursor({ updatedAt: last.updatedAt, id: last.id, scope })
          : null,
      };
    },
  });
  tools.create_conversation = tool({
    description: 'Crea una conversación nueva y vacía para el usuario autenticado, con el perfil predeterminado. Usala únicamente cuando el usuario pida explícitamente crear o abrir un hilo nuevo; nunca por iniciativa propia.',
    inputSchema: jsonSchema<{ title?: string }>({
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200, description: 'Título opcional para el nuevo hilo.' },
      },
      additionalProperties: false,
    }),
    execute: async ({ title }) => {
      console.info('tool create_conversation invoked');
      const profile = await getNewChatDefaultAgentProfile();
      const normalizedTitle = title?.trim();
      const created = await createConversation(
        principal,
        normalizedTitle || null,
        profile.id,
      );
      return {
        id: created.id,
        title: created.title,
        createdAt: created.createdAt,
        agentProfileId: created.agentProfileId,
      };
    },
  });

  const memorySearchToolName = 'memory__searchMemory';
  if (Object.hasOwn(tools, memorySearchToolName)) {
    throw new AgentToolNameConflictError();
  }
  tools[memorySearchToolName] = tool({
    description:
      'Busca en los recuerdos y mensajes anteriores del usuario autenticado. Usala cuando la respuesta dependa de conversaciones previas o cuando el usuario pregunte qué se habló o decidió antes. Para buscar en todas las conversaciones, omití por completo conversationId; no lo envíes como cadena vacía. Incluilo solo si el usuario pide limitar la búsqueda a una conversación concreta y tenés su ID.',
    inputSchema: jsonSchema<{
      query: string;
      conversationId?: string;
      limit?: number;
    }>({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Qué información o tema buscar en recuerdos anteriores.',
        },
        conversationId: {
          type: 'string',
          description:
            'Opcional. Incluilo solo para limitar la búsqueda a una conversación concreta. Para buscar en todas las conversaciones, omití este campo por completo; nunca envíes "".',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Cantidad máxima de resultados (1 a 20).',
        },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    execute: async ({ query, conversationId: searchConversationId, limit }) => {
      console.info('tool memory__searchMemory invoked');
      const normalizedConversationId = searchConversationId?.trim() || undefined;
      return memory.searchMemory({
        userId: principal.userId,
        query,
        ...(normalizedConversationId
          ? { conversationId: normalizedConversationId }
          : {}),
        limit,
      });
    },
  });

  const preferenceToolNames = [
    'memory__savePreference',
    'memory__listPreferences',
    'memory__deletePreference',
  ];
  if (preferenceToolNames.some((name) => Object.hasOwn(tools, name))) {
    throw new AgentToolNameConflictError();
  }
  tools.memory__savePreference = tool({
    description: 'Guarda una preferencia solo cuando el usuario pide explícitamente que se recuerde o se aplique en el futuro. No guardes instrucciones puntuales de la tarea actual ni infieras preferencias permanentes. Expresá claramente la condición de activación.',
    inputSchema: jsonSchema<{
      preference: string;
      activationCondition: string;
      category?: string;
    }>({
      type: 'object',
      properties: {
        preference: { type: 'string', minLength: 1, maxLength: 2_000, description: 'La instrucción de trabajo preferida por el usuario.' },
        activationCondition: { type: 'string', minLength: 1, maxLength: 1_000, description: 'En qué tipo de pedidos o situaciones se activa.' },
        category: { type: 'string', maxLength: 100, description: 'Categoría breve, por ejemplo: cambios de código.' },
      },
      required: ['preference', 'activationCondition'],
      additionalProperties: false,
    }),
    execute: async ({ preference, activationCondition, category }) => {
      console.info('tool memory__savePreference invoked');
      return memory.savePreference({
        userId: principal.userId,
        preference,
        activationCondition,
        category,
      });
    },
  });
  tools.memory__listPreferences = tool({
    description: 'Lista preferencias guardadas cuando el usuario pregunta cuáles recuerda o quiere administrarlas.',
    inputSchema: jsonSchema<Record<string, never>>({
      type: 'object',
      properties: {},
      additionalProperties: false,
    }),
    execute: async () => memory.listPreferences({ userId: principal.userId }),
  });
  tools.memory__deletePreference = tool({
    description: 'Elimina permanentemente una preferencia guardada cuando el usuario pide olvidarla, eliminarla o reemplazarla. Para reemplazarla, lista si hace falta, elimina la anterior y guarda la nueva con memory__savePreference.',
    inputSchema: jsonSchema<{ id: string }>({
      type: 'object',
      properties: { id: { type: 'string', description: 'ID de la preferencia obtenida al listarla.' } },
      required: ['id'],
      additionalProperties: false,
    }),
    execute: async ({ id }) => memory.deletePreference({ userId: principal.userId, id }),
  });

  if (delegationEnabled) {
    if (Object.hasOwn(tools, 'delegate_to_conversation') || Object.hasOwn(tools, 'get_delegation_status')) {
      throw new AgentToolNameConflictError();
    }
    tools.delegate_to_conversation = tool({
      description: 'Encola una instrucción en otro hilo del mismo usuario. Usala únicamente si el usuario pidió explícitamente delegar esa tarea; no elijas trabajo autónomamente. La ejecución es asíncrona y no reintenta tras una caída. Devuelve un id para consultar estado y eventos.',
      inputSchema: jsonSchema<{ conversationId: string; instruction: string }>({
        type: 'object',
        properties: {
          conversationId: { type: 'string', format: 'uuid', description: 'Id del hilo destinatario, que debe pertenecer al usuario.' },
          instruction: { type: 'string', minLength: 1, maxLength: 100_000 },
        },
        required: ['conversationId', 'instruction'],
        additionalProperties: false,
      }),
      execute: async ({ conversationId: targetId, instruction }) => {
        const targetIdTrimmed = targetId.trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetIdTrimmed)) {
          return { error: 'El id del hilo destinatario no es válido.' };
        }
        const canonicalTargetId = targetIdTrimmed.toLowerCase();
        if (canonicalTargetId === conversationId.toLowerCase()) {
          return { error: 'No se puede delegar al mismo hilo de origen.' };
        }
        // Los UUID son case-insensitive; conservar su forma canónica evita claves duplicadas en la UI.
        const trimmedInstruction = instruction.trim();
        if (!trimmedInstruction || trimmedInstruction.length > 100_000) {
          return { error: 'La instrucción debe tener entre 1 y 100000 caracteres.' };
        }
        const target = await getConversation(principal, canonicalTargetId);
        if (target.archivedAt || !target.agentProfileId) {
          return { error: 'El hilo destinatario está archivado o no tiene un perfil asignado.' };
        }
        const job = await enqueueDelegation({
          principal,
          sourceConversationId: conversationId,
          targetConversationId: canonicalTargetId,
          instruction: trimmedInstruction,
          accessToken,
          mcpTokens: mcpTokens ?? null,
        });
        return {
          delegationId: job.id,
          status: job.status,
          statusUrl: `/v1/delegations/${job.id}`,
          eventsUrl: `/v1/delegations/${job.id}/events`,
          targetConversationId: canonicalTargetId,
        };
      },
    });
    tools.get_delegation_status = tool({
      description: 'Consulta el estado de una delegación creada previamente por este usuario. Si terminó, devuelve la respuesta guardada en el hilo destinatario. Usala cuando el usuario pregunte por el progreso o resultado de una delegación; no inicia tareas.',
      inputSchema: jsonSchema<{ delegationId: string }>({
        type: 'object',
        properties: { delegationId: { type: 'string', format: 'uuid' } },
        required: ['delegationId'],
        additionalProperties: false,
      }),
      execute: async ({ delegationId }) => {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(delegationId)) {
          return { error: 'El id de delegación no es válido.' };
        }
        const job = await getDelegationForUser(delegationId, principal.userId);
        if (!job) return { error: 'No se encontró una delegación de este usuario con ese id.' };
        let result: string | undefined;
        if (job.status === 'completed' && job.startedAt && job.finishedAt) {
          const startedAt = job.startedAt.getTime();
          const finishedAt = job.finishedAt.getTime();
          const resultPages: string[][] = [];
          let before: { createdAt: string; id: string } | undefined;
          while (true) {
            const page = await memory.listMessages({
              conversationId: job.targetConversationId,
              userId: principal.userId,
              limit: 100,
              ...(before ? { before } : {}),
            });
            resultPages.push(page.items
              .filter((message) => {
                const createdAt = Date.parse(message.createdAt);
                return message.role === 'assistant' && createdAt >= startedAt && createdAt <= finishedAt;
              })
              .map((message) => message.content)
              .filter(Boolean));
            if (!page.hasMore || !page.nextCursor || !page.items[0]
              || Date.parse(page.items[0].createdAt) < startedAt) break;
            before = page.nextCursor;
          }
          result = resultPages.reverse().flat().join('\n\n').slice(-20_000);
        }
        return {
          delegationId: job.id,
          status: job.status,
          targetConversationId: job.targetConversationId,
          errorCode: job.errorCode,
          ...(result ? { result } : {}),
        };
      },
    });
  }


  return tools;
}
