import { randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { acquireConversationTurn } from '../agent/turn/lock.js';
import { getConversation } from '../conversations/service.js';
import { getAgentProfile } from '../runtime-config/agent-profiles.js';
import { resolveModel } from '../llm/provider.js';
import { streamAgentTurn } from '../agent/turn/run.js';
import { delegationEncryptionEnabled, openDelegationPayload } from './payload.js';
import {
  claimDelegation,
  deferDelegation,
  finishDelegation,
  renewDelegation,
  recordDelegationStarted,
} from './persistence.js';
import type { DelegationPayload, DelegationJob } from './contracts.js';
import { DELEGATION_LEASE_MS, DELEGATION_RENEW_INTERVAL_MS, DELEGATION_WORKER_POLL_INTERVAL_MS } from './constants.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function consume(response: Response): Promise<void> {
  if (!response.ok) throw new Error(`turn_http_${response.status}`);
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamError = false;
  const inspectBlock = (block: string) => {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data || data === '[DONE]') return;
    try {
      const part = JSON.parse(data) as { type?: unknown };
      if (part.type === 'error') streamError = true;
    } catch {
      // Ignora metadata no JSON; los errores del UI Message Stream sí son JSON.
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) inspectBlock(block);
      if (done) {
        if (buffer) inspectBlock(buffer);
        break;
      }
    }
    if (streamError) throw new Error('turn_stream_error');
  } finally {
    reader.releaseLock();
  }
}

/** Ejecuta una delegación reclamada, renovando ambos leases y guardando el estado terminal. */
async function processJob(job: DelegationJob, workerId: string): Promise<void> {
  let payload: DelegationPayload;
  try {
    payload = openDelegationPayload<DelegationPayload>({
      ciphertext: job.payload_ciphertext,
      nonce: job.payload_nonce,
      tag: job.payload_tag,
    });
  } catch (error) {
    console.error('No se pudo descifrar una delegación; se marca como fallida.', error);
    await finishDelegation(job.id, workerId, 'failed', 'payload_unavailable');
    return;
  }

  let turnLease: Awaited<ReturnType<typeof acquireConversationTurn>> = null;
  let leaseLost = false;
  let renewTimer: ReturnType<typeof setInterval> | undefined;
  const controller = new AbortController();
  try {
    const conversation = await getConversation(payload.principal, job.target_conversation_id);
    if (conversation.archivedAt || !conversation.agentProfileId) {
      throw new Error('target_unavailable');
    }
    const profile = await getAgentProfile(conversation.agentProfileId, true);
    if (!profile) throw new Error('profile_unavailable');
    const model = resolveModel(profile.model.chat, profile.config.chat.contextTokenBudget);
    if (!model) throw new Error('model_unavailable');

    turnLease = await acquireConversationTurn(payload.principal.userId, job.target_conversation_id);
    if (!turnLease) {
      await deferDelegation(job.id, workerId);
      return;
    }
    await recordDelegationStarted(job.id, workerId, job.target_conversation_id);
    renewTimer = setInterval(() => {
      void renewDelegation(job.id, workerId, DELEGATION_LEASE_MS).then((renewed) => {
        if (!renewed) {
          leaseLost = true;
          controller.abort(new Error('Se perdió la reserva del trabajo delegado.'));
        }
      }).catch((error: unknown) => {
        leaseLost = true;
        controller.abort(error);
        console.error('No se pudo renovar la delegación.', error);
      });
    }, DELEGATION_RENEW_INTERVAL_MS);
    renewTimer.unref?.();

    const response = await streamAgentTurn(
      job.target_conversation_id,
      payload.principal,
      payload.accessToken,
      payload.instruction,
      model,
      AbortSignal.any([turnLease.signal, controller.signal]),
      payload.mcpTokens ?? undefined,
      [],
      profile,
    );
    await consume(response);
    if (leaseLost || turnLease.signal.aborted) {
      await finishDelegation(job.id, workerId, 'failed', 'worker_lease_lost');
      return;
    }
    await finishDelegation(job.id, workerId, 'completed');
  } catch (error) {
    if (error instanceof HTTPException) {
      console.error('Falló la ejecución de una delegación.', error.message);
    } else {
      console.error('Falló la ejecución de una delegación.', error);
    }
    await finishDelegation(job.id, workerId, 'failed', 'execution_failed');
  } finally {
    if (renewTimer) clearInterval(renewTimer);
    if (turnLease) await turnLease.release().catch((error: unknown) => console.error('No se pudo liberar el turno delegado.', error));
  }
}

/** Inicia el worker de delegaciones y procesa trabajos hasta recibir SIGTERM/SIGINT. */
export function startDelegationWorker(): void {
  if (!delegationEncryptionEnabled()) {
    console.info('Delegaciones deshabilitadas: configurá DELEGATION_PAYLOAD_ENCRYPTION_KEY en todas las réplicas para habilitarlas.');
    return;
  }
  const workerId = randomUUID();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  void (async () => {
    console.info(`Worker de delegaciones iniciado (${workerId}).`);
    while (!stopping) {
      try {
        const job = await claimDelegation(workerId, DELEGATION_LEASE_MS);
        if (job) {
          await processJob(job, workerId);
          continue;
        }
      } catch (error) {
        console.error('Error al reclamar delegaciones.', error);
      }
      await sleep(DELEGATION_WORKER_POLL_INTERVAL_MS);
    }
  })();
}
