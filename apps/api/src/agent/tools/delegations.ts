import { jsonSchema, tool, type Tool } from 'ai';
import { getConversation } from '../../conversations/service.js';
import { enqueueDelegation, getDelegationForUser } from '../../delegations/store.js';
import type { AgentToolContext } from './context.js';

/** Construye herramientas para encolar delegaciones y consultar su estado. */
export function buildDelegationTools({
  memory,
  principal,
  conversationId,
  accessToken,
  mcpTokens,
}: AgentToolContext): Record<string, Tool> {
  return {
    delegate_to_conversation: tool({
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
    }),
    get_delegation_status: tool({
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
    }),
  };
}
