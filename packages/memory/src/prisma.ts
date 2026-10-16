import { PrismaClient } from '@prisma/client';

/** Cliente Prisma compartido por las operaciones persistentes de Memory. */
export const prisma = new PrismaClient();
