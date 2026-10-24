import { jsonSchema, tool, type Tool } from 'ai';
import { saveConversationObjective } from '../../conversation-objectives/persistence.js';
import type { AgentToolContext } from './context.js';

export function buildObjectiveTools({ principal, conversationId }: AgentToolContext): Record<string, Tool> {
  return {
    update_conversation_objective: tool({
      description: 'Crea o actualiza el único objetivo persistente de esta conversación. Usala solo ante una tarea concreta, al actualizar progreso/bloqueos/cambio claro de resultado o cuando haya evidencia para completarlo; no la uses para charla ni consultas independientes. Reemplazá los pasos obsoletos al cambiar de objetivo y enviá el estado completo. Para completarlo, exigí y citá en completionEvidence resultados concretos ya confirmados por el usuario o por herramientas; no infieras que terminó por intención o promesa. Usá expectedRevision null solo para crear; al actualizar, enviá la revisión recuperada en el contexto.',
      inputSchema: jsonSchema<{
        title: string; description: string; status: 'active' | 'blocked' | 'completed';
        steps: { id: string; description: string; status: 'pending' | 'in_progress' | 'completed' }[];
        nextStep: string | null; expectedRevision: number | null; completionEvidence?: string | null;
      }>({
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 200 },
          description: { type: 'string', maxLength: 2_000 },
          status: { type: 'string', enum: ['active', 'blocked', 'completed'] },
          steps: {
            type: 'array', maxItems: 20,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', minLength: 1, maxLength: 80 },
                description: { type: 'string', minLength: 1, maxLength: 500 },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['id', 'description', 'status'],
            },
          },
          nextStep: { type: ['string', 'null'], maxLength: 500 },
          expectedRevision: { type: ['integer', 'null'], minimum: 0 },
          completionEvidence: { type: ['string', 'null'], maxLength: 2_000 },
        },
        required: ['title', 'description', 'status', 'steps', 'nextStep', 'expectedRevision'],
        additionalProperties: false,
      }),
      execute: async (input) => saveConversationObjective(conversationId, principal.userId, input),
    }),
  };
}
