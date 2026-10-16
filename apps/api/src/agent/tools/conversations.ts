import { jsonSchema, tool, type Tool } from 'ai';
import { createConversation } from '../../conversations/service.js';
import { listConversations as listConversationRecords } from '../../conversations/persistence.js';
import { getNewChatDefaultAgentProfile } from '../../runtime-config/agent-profiles.js';
import { decodeOptionalConversationCursor, encodeConversationCursor, type ConversationListScope } from '../../conversations/cursor.js';
import type { AgentToolContext } from './context.js';

/** Construye herramientas para listar y crear conversaciones del principal actual. */
export function buildConversationTools({ principal }: AgentToolContext): Record<string, Tool> {
  return {
    list_conversations: tool({
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
        const page = await listConversationRecords({
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
    }),
    create_conversation: tool({
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
    }),
  };
}
