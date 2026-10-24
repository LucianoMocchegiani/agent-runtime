import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { assertConversationOwner } from '../conversations/access.js';

export const OBJECTIVE_STATES = ['active', 'blocked', 'completed'] as const;
export const OBJECTIVE_STEP_STATES = ['pending', 'in_progress', 'completed'] as const;

export type ObjectiveStep = {
  id: string;
  description: string;
  status: (typeof OBJECTIVE_STEP_STATES)[number];
};

export type ConversationObjective = {
  id: string;
  conversationId: string;
  title: string;
  description: string;
  status: (typeof OBJECTIVE_STATES)[number];
  steps: ObjectiveStep[];
  nextStep: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ObjectiveInput = Pick<ConversationObjective, 'title' | 'description' | 'status' | 'steps' | 'nextStep'> & {
  expectedRevision: number | null;
  completionEvidence?: string | null;
};

export function validateObjectiveInput(input: ObjectiveInput): string | null {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) return 'El título debe tener entre 1 y 200 caracteres.';
  if (typeof input.description !== 'string' || !input.description.trim() || input.description.trim().length > 2_000) return 'La descripción debe tener entre 1 y 2000 caracteres.';
  if (!OBJECTIVE_STATES.includes(input.status)) return 'El estado del objetivo no es válido.';
  if (!Array.isArray(input.steps) || input.steps.length > 20) return 'Debe haber como máximo 20 pasos.';
  const ids = new Set<string>();
  for (const step of input.steps) {
    const id = typeof step?.id === 'string' ? step.id.trim() : '';
    if (!id || id.length > 80 || ids.has(id)) return 'Los identificadores de pasos deben ser únicos y válidos.';
    if (typeof step.description !== 'string' || !step.description.trim() || step.description.trim().length > 500) return 'La descripción de cada paso debe tener entre 1 y 500 caracteres.';
    if (!OBJECTIVE_STEP_STATES.includes(step.status)) return 'El estado de un paso no es válido.';
    ids.add(id);
  }
  if (input.nextStep !== null && (typeof input.nextStep !== 'string' || input.nextStep.trim().length > 500)) return 'El próximo paso debe tener hasta 500 caracteres.';
  if (input.expectedRevision !== null && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0)) return 'La revisión esperada no es válida.';
  if (input.status === 'completed' && (typeof input.completionEvidence !== 'string' || input.completionEvidence.trim().length < 20)) return 'Para completar el objetivo se requiere evidencia concreta de finalización.';
  const normalizedLength = input.title.trim().length + input.description.trim().length
    + input.steps.reduce((length, step) => length + step.id.trim().length + step.description.trim().length, 0)
    + (input.nextStep?.trim().length ?? 0);
  if (normalizedLength > 6_000) return 'El objetivo excede el límite de contexto permitido.';
  return null;
}

function toDto(row: {
  id: string; conversationId: string; title: string; description: string; status: string;
  steps: Prisma.JsonValue; nextStep: string | null; revision: number; createdAt: Date; updatedAt: Date;
}): ConversationObjective {
  return {
    ...row,
    status: row.status as ConversationObjective['status'],
    steps: row.steps as ObjectiveStep[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getConversationObjective(conversationId: string, userId: string): Promise<ConversationObjective | null> {
  await assertConversationOwner(conversationId, userId);
  const row = await prisma.conversationObjective.findUnique({ where: { conversationId } });
  return row ? toDto(row) : null;
}

/** Null revision creates; numeric revision updates only that exact version, avoiding stale writes. */
export async function saveConversationObjective(
  conversationId: string,
  userId: string,
  input: ObjectiveInput,
): Promise<{ objective?: ConversationObjective; error?: string }> {
  const invalid = validateObjectiveInput(input);
  if (invalid) return { error: invalid };
  await assertConversationOwner(conversationId, userId);
  const data = {
    title: input.title.trim(),
    description: input.description.trim(),
    status: input.status,
    steps: input.steps.map((step) => ({ ...step, id: step.id.trim(), description: step.description.trim() })) as Prisma.InputJsonValue,
    nextStep: input.nextStep?.trim() || null,
  };
  if (input.expectedRevision === null) {
    try {
      const row = await prisma.conversationObjective.create({ data: { ...data, conversationId } });
      return { objective: toDto(row) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { error: 'El objetivo cambió en otro turno; recuperá su revisión actual antes de actualizar.' };
      }
      throw error;
    }
  }
  const updated = await prisma.conversationObjective.updateMany({
    where: { conversationId, revision: input.expectedRevision, conversation: { is: { userId } } },
    data: { ...data, revision: { increment: 1 } },
  });
  if (updated.count !== 1) return { error: 'El objetivo cambió en otro turno; recuperá su revisión actual antes de actualizar.' };
  const row = await prisma.conversationObjective.findUniqueOrThrow({ where: { conversationId } });
  return { objective: toDto(row) };
}
