import { prisma } from '../db/prisma.js';

export class LastRuntimeAdminError extends Error {
  constructor() {
    super('Cannot remove the last runtime administrator');
    this.name = 'LastRuntimeAdminError';
  }
}

export async function listRuntimeAdmins() {
  return prisma.runtimeAdmin.findMany({
    orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
    select: { userId: true, createdAt: true, createdByUserId: true },
  });
}

export async function addRuntimeAdmin(userId: string, createdByUserId: string) {
  return prisma.runtimeAdmin.upsert({
    where: { userId },
    create: { userId, createdByUserId },
    update: {},
    select: { userId: true, createdAt: true, createdByUserId: true },
  });
}

/** Serializa las revocaciones para garantizar que nunca se elimine el último administrador. */
export async function removeRuntimeAdmin(userId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Un lock transaccional compartido por todos los procesos evita carreras entre revocaciones.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(82736412051)`;
    const existing = await tx.runtimeAdmin.findUnique({ where: { userId }, select: { userId: true } });
    if (!existing) return false;

    const count = await tx.runtimeAdmin.count();
    if (count <= 1) throw new LastRuntimeAdminError();
    await tx.runtimeAdmin.delete({ where: { userId } });
    return true;
  });
}
