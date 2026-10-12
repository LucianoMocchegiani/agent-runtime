import { randomUUID } from 'node:crypto';
import { prisma } from 'agent-runtime-memory';
import type { Prisma } from '@prisma/client';
import { sealDelegationPayload } from './payload.js';
import type { Principal } from '../auth/principal.js';

export type DelegationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';
export type DelegationPayload = {
  principal: Principal;
  accessToken: string;
  mcpTokens: Record<string, string> | null;
  instruction: string;
};
export type DelegationJob = {
  id: string;
  user_id: string;
  source_conversation_id: string;
  target_conversation_id: string;
  status: DelegationStatus;
  payload_ciphertext: Buffer;
  payload_nonce: Buffer;
  payload_tag: Buffer;
  claimed_by: string | null;
};
export type DelegationEvent = {
  id: string;
  jobId: string;
  type: string;
  data: unknown;
  createdAt: Date;
};

export async function enqueueDelegation(input: {
  principal: Principal;
  sourceConversationId: string;
  targetConversationId: string;
  instruction: string;
  accessToken: string;
  mcpTokens: Record<string, string> | null;
}): Promise<{ id: string; status: 'queued' }> {
  const id = randomUUID();
  const sealed = sealDelegationPayload({
    principal: input.principal,
    accessToken: input.accessToken,
    mcpTokens: input.mcpTokens,
    instruction: input.instruction,
  } satisfies DelegationPayload);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO runtime.delegation_jobs
        (id, user_id, source_conversation_id, target_conversation_id, status,
         payload_ciphertext, payload_nonce, payload_tag)
      VALUES (${id}::uuid, ${input.principal.userId}, ${input.sourceConversationId}::uuid,
        ${input.targetConversationId}::uuid, 'queued', ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.tag})
    `;
    await tx.$executeRaw`
      INSERT INTO runtime.delegation_events (job_id, event_type, data)
      VALUES (${id}::uuid, 'queued', jsonb_build_object('targetConversationId', ${input.targetConversationId}))
    `;
  });
  return { id, status: 'queued' };
}

/** Marca trabajos cuyo worker desapareció como interrupted; nunca los vuelve a ejecutar. */
async function interruptExpiredJobs(tx: Prisma.TransactionClient): Promise<void> {
  const expired = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE runtime.delegation_jobs
    SET status = 'interrupted', claimed_by = NULL, lease_until = NULL,
        finished_at = clock_timestamp(), error_code = 'worker_lost',
        payload_ciphertext = decode('', 'hex'), payload_nonce = decode('', 'hex'), payload_tag = decode('', 'hex')
    WHERE status = 'running' AND lease_until <= clock_timestamp()
    RETURNING id::text
  `;
  for (const { id } of expired) {
    await tx.$executeRaw`
      INSERT INTO runtime.delegation_events (job_id, event_type, data)
      VALUES (${id}::uuid, 'interrupted', jsonb_build_object('reason', 'worker_lost'))
    `;
  }
}

export async function claimDelegation(workerId: string, leaseMs = 120_000): Promise<DelegationJob | null> {
  return prisma.$transaction(async (tx) => {
    await interruptExpiredJobs(tx);
    const rows = await tx.$queryRaw<DelegationJob[]>`
      WITH candidate AS (
        SELECT id FROM runtime.delegation_jobs
        WHERE status = 'queued' AND available_at <= clock_timestamp()
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE runtime.delegation_jobs AS job
      SET status = 'running', claimed_by = ${workerId},
          lease_until = clock_timestamp() + (${leaseMs} * interval '1 millisecond')
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING job.id::text, job.user_id, job.source_conversation_id::text,
        job.target_conversation_id::text, job.status, job.payload_ciphertext,
        job.payload_nonce, job.payload_tag, job.claimed_by
    `;
    return rows[0] ?? null;
  });
}

export async function recordDelegationStarted(jobId: string, workerId: string, targetConversationId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE runtime.delegation_jobs
      SET started_at = clock_timestamp()
      WHERE id = ${jobId}::uuid AND status = 'running' AND claimed_by = ${workerId}
        AND lease_until > clock_timestamp()
      RETURNING id::text
    `;
    if (rows.length === 0) throw new Error('Se perdió la reserva del trabajo delegado.');
    await tx.$executeRaw`
      INSERT INTO runtime.delegation_events (job_id, event_type, data)
      VALUES (${jobId}::uuid, 'started', jsonb_build_object('targetConversationId', ${targetConversationId}))
    `;
  });
}

export async function renewDelegation(jobId: string, workerId: string, leaseMs = 120_000): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE runtime.delegation_jobs
    SET lease_until = clock_timestamp() + (${leaseMs} * interval '1 millisecond')
    WHERE id = ${jobId}::uuid AND status = 'running' AND claimed_by = ${workerId}
      AND lease_until > clock_timestamp()
    RETURNING id::text
  `;
  return rows.length === 1;
}

export async function deferDelegation(jobId: string, workerId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE runtime.delegation_jobs
    SET status = 'queued', claimed_by = NULL, lease_until = NULL,
        available_at = clock_timestamp() + interval '2 seconds'
    WHERE id = ${jobId}::uuid AND status = 'running' AND claimed_by = ${workerId}
      AND lease_until > clock_timestamp()
  `;
}

export async function finishDelegation(
  jobId: string,
  workerId: string,
  status: 'completed' | 'failed',
  errorCode?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; target_conversation_id: string }>>`
      UPDATE runtime.delegation_jobs
      SET status = ${status}, claimed_by = NULL, lease_until = NULL,
          finished_at = clock_timestamp(), error_code = ${errorCode ?? null}::text,
          payload_ciphertext = decode('', 'hex'), payload_nonce = decode('', 'hex'), payload_tag = decode('', 'hex')
      WHERE id = ${jobId}::uuid AND status = 'running' AND claimed_by = ${workerId}
        AND lease_until > clock_timestamp()
      RETURNING id::text, target_conversation_id::text
    `;
    const job = rows[0];
    if (!job) return;
    const eventData = JSON.stringify({
      targetConversationId: job.target_conversation_id,
      errorCode: errorCode ?? null,
    });
    await tx.$executeRaw`
      INSERT INTO runtime.delegation_events (job_id, event_type, data)
      VALUES (${jobId}::uuid, ${status}, ${eventData}::jsonb)
    `;
  });
}

export async function listDelegationsForUser(userId: string, limit = 100): Promise<Array<{
  id: string; status: DelegationStatus; sourceConversationId: string; targetConversationId: string;
  createdAt: Date; startedAt: Date | null; finishedAt: Date | null; errorCode: string | null;
}>> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; status: DelegationStatus; source_conversation_id: string; target_conversation_id: string;
    created_at: Date; started_at: Date | null; finished_at: Date | null; error_code: string | null;
  }>>`
    SELECT id::text, status, source_conversation_id::text, target_conversation_id::text,
      created_at, started_at, finished_at, error_code
    FROM runtime.delegation_jobs
    WHERE user_id = ${userId}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    id: row.id, status: row.status, sourceConversationId: row.source_conversation_id,
    targetConversationId: row.target_conversation_id, createdAt: row.created_at,
    startedAt: row.started_at, finishedAt: row.finished_at, errorCode: row.error_code,
  }));
}

export async function getDelegationForUser(jobId: string, userId: string): Promise<{
  id: string; status: DelegationStatus; sourceConversationId: string; targetConversationId: string;
  createdAt: Date; startedAt: Date | null; finishedAt: Date | null; errorCode: string | null;
} | null> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; status: DelegationStatus; source_conversation_id: string; target_conversation_id: string;
    created_at: Date; started_at: Date | null; finished_at: Date | null; error_code: string | null;
  }>>`
    SELECT id::text, status, source_conversation_id::text, target_conversation_id::text,
      created_at, started_at, finished_at, error_code
    FROM runtime.delegation_jobs WHERE id = ${jobId}::uuid AND user_id = ${userId}
  `;
  const row = rows[0];
  return row ? {
    id: row.id, status: row.status, sourceConversationId: row.source_conversation_id,
    targetConversationId: row.target_conversation_id, createdAt: row.created_at,
    startedAt: row.started_at, finishedAt: row.finished_at, errorCode: row.error_code,
  } : null;
}

export async function listDelegationEvents(jobId: string, afterId: string): Promise<DelegationEvent[]> {
  return prisma.$queryRaw<DelegationEvent[]>`
    SELECT id::text, job_id::text AS "jobId", event_type AS type, data, created_at AS "createdAt"
    FROM runtime.delegation_events
    WHERE job_id = ${jobId}::uuid AND id > ${afterId}::bigint
    ORDER BY id
    LIMIT 100
  `;
}
