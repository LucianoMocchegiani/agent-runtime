import { randomUUID } from 'node:crypto';
import { prisma } from '../../db/prisma.js';

type LeaseStore = {
  claim(userId: string, conversationId: string, token: string, leaseMs: number): Promise<boolean>;
  renew(userId: string, conversationId: string, token: string, leaseMs: number): Promise<boolean>;
  release(userId: string, conversationId: string, token: string): Promise<void>;
};

/** Reserva exclusiva de un turno; su señal se aborta si el lease se pierde. */
export type ConversationTurnLease = {
  /** Se aborta si la instancia pierde o no puede renovar la reserva compartida. */
  signal: AbortSignal;
  /** Idempotente. Completa la liberación persistida antes de resolver. */
  release(): Promise<void>;
};

/** Duraciones configurables para la reserva y su renovación periódica. */
export type ConversationTurnLockerOptions = {
  leaseMs?: number;
  renewEveryMs?: number;
};

/**
 * Crea una función de adquisición de leases; PostgreSQL es el almacén de producción y
 * el store inyectable permite probarla sin base de datos.
 * @param store Operaciones atómicas para reclamar, renovar y liberar la reserva.
 * @param options Duración del lease y frecuencia de renovación.
 * @returns Función que devuelve `null` si otro proceso ya posee el turno.
 * @throws {Error} Si el intervalo no es positivo o no es menor que la duración del lease.
 */
export function createConversationTurnLocker(
  store: LeaseStore,
  { leaseMs = 120_000, renewEveryMs = 30_000 }: ConversationTurnLockerOptions = {},
) {
  if (leaseMs <= renewEveryMs || renewEveryMs <= 0) {
    throw new Error('La duración del lease debe ser mayor que el intervalo de renovación.');
  }

  return async function acquireConversationTurn(
    userId: string,
    conversationId: string,
  ): Promise<ConversationTurnLease | null> {
    const token = randomUUID();
    if (!(await store.claim(userId, conversationId, token, leaseMs))) return null;

    const controller = new AbortController();
    let released = false;
    let renewal: Promise<void> | null = null;
    let releasePromise: Promise<void> | null = null;

    const timer = setInterval(() => {
      if (released || renewal) return;
      renewal = store.renew(userId, conversationId, token, leaseMs)
        .then((renewed) => {
          if (!renewed) controller.abort(new Error('Se perdió la reserva del turno.'));
        })
        .catch((error: unknown) => {
          console.error('No se pudo renovar la reserva del turno; se aborta para evitar concurrencia.', error);
          controller.abort(error);
        })
        .finally(() => { renewal = null; });
    }, renewEveryMs);
    timer.unref?.();

    return {
      signal: controller.signal,
      release: () => {
        if (releasePromise) return releasePromise;
        released = true;
        clearInterval(timer);
        releasePromise = (async () => {
          if (renewal) await renewal;
          await store.release(userId, conversationId, token);
        })();
        return releasePromise;
      },
    };
  };
}

const postgresStore: LeaseStore = {
  async claim(userId, conversationId, token, leaseMs) {
    // Limpieza acotada de leases vencidos para no retener filas de hilos inactivos.
    await prisma.$executeRaw`
      WITH expired AS (
        SELECT ctid FROM runtime.conversation_turn_leases
        WHERE expires_at <= clock_timestamp()
        LIMIT 100
      )
      DELETE FROM runtime.conversation_turn_leases AS lease
      USING expired
      WHERE lease.ctid = expired.ctid
    `;
    const rows = await prisma.$queryRaw<Array<{ owner_token: string }>>`
      INSERT INTO runtime.conversation_turn_leases
        (user_id, conversation_id, owner_token, expires_at)
      VALUES
        (${userId}, ${conversationId}::uuid, ${token}::uuid,
         clock_timestamp() + (${leaseMs} * interval '1 millisecond'))
      ON CONFLICT (user_id, conversation_id) DO UPDATE
        SET owner_token = EXCLUDED.owner_token,
            expires_at = EXCLUDED.expires_at
        WHERE runtime.conversation_turn_leases.expires_at <= clock_timestamp()
      RETURNING owner_token
    `;
    return rows.length === 1;
  },

  async renew(userId, conversationId, token, leaseMs) {
    const rows = await prisma.$queryRaw<Array<{ owner_token: string }>>`
      UPDATE runtime.conversation_turn_leases
      SET expires_at = clock_timestamp() + (${leaseMs} * interval '1 millisecond')
      WHERE user_id = ${userId}
        AND conversation_id = ${conversationId}::uuid
        AND owner_token = ${token}::uuid
        AND expires_at > clock_timestamp()
      RETURNING owner_token
    `;
    return rows.length === 1;
  },

  async release(userId, conversationId, token) {
    await prisma.$executeRaw`
      DELETE FROM runtime.conversation_turn_leases
      WHERE user_id = ${userId}
        AND conversation_id = ${conversationId}::uuid
        AND owner_token = ${token}::uuid
    `;
  },
};

/** Adquiere en PostgreSQL el lease exclusivo de una conversación. */
export const acquireConversationTurn = createConversationTurnLocker(postgresStore);
