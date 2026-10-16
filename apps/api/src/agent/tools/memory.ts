import { jsonSchema, tool, type Tool } from 'ai';
import { searchMemory } from '../../memory/search/service.js';
import {
  savePreference,
  listPreferences,
  deletePreference,
} from '../../preferences/persistence.js';
import type { AgentToolContext } from './context.js';

/** Construye herramientas de búsqueda y administración de recuerdos/preferencias del usuario. */
export function buildMemoryTools({ principal }: AgentToolContext): Record<string, Tool> {
  return {
    memory__searchMemory: tool({
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
        return searchMemory({
          userId: principal.userId,
          query,
          ...(normalizedConversationId
            ? { conversationId: normalizedConversationId }
            : {}),
          limit,
        });
      },
    }),
    memory__savePreference: tool({
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
        return savePreference({
          userId: principal.userId,
          preference,
          activationCondition,
          category,
        });
      },
    }),
    memory__listPreferences: tool({
      description: 'Lista preferencias guardadas cuando el usuario pregunta cuáles recuerda o quiere administrarlas.',
      inputSchema: jsonSchema<Record<string, never>>({
        type: 'object',
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => listPreferences({ userId: principal.userId }),
    }),
    memory__deletePreference: tool({
      description: 'Elimina permanentemente una preferencia guardada cuando el usuario pide olvidarla, eliminarla o reemplazarla. Para reemplazarla, lista si hace falta, elimina la anterior y guarda la nueva con memory__savePreference.',
      inputSchema: jsonSchema<{ id: string }>({
        type: 'object',
        properties: { id: { type: 'string', description: 'ID de la preferencia obtenida al listarla.' } },
        required: ['id'],
        additionalProperties: false,
      }),
      execute: async ({ id }) => deletePreference({ userId: principal.userId, id }),
    }),
  };
}
