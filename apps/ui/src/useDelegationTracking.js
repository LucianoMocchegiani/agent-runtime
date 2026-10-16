import { useCallback, useEffect, useState } from 'react';
import client from './client.js';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'interrupted']);
const ACTIVE_STATUSES = new Set(['queued', 'running']);

export default function useDelegationTracking() {
  const [delegationByConversation, setDelegationByConversation] = useState({});

  const refreshDelegations = useCallback(async () => {
    try {
      const items = await client.delegations.list();
      const next = {};
      for (const delegation of [...items].reverse()) {
        next[delegation.targetConversationId] = delegation;
      }
      setDelegationByConversation(next);
    } catch {
      // La lista puede seguir usándose aunque el seguimiento de delegaciones no esté disponible.
    }
  }, []);

  useEffect(() => { void refreshDelegations(); }, [refreshDelegations]);

  // Seguimos las delegaciones activas por SSE, en vez de consultar periódicamente
  // toda la lista. El endpoint reanuda desde el último ID si hay que reconectar.
  const activeDelegationIds = Object.values(delegationByConversation)
    .filter(delegation => ACTIVE_STATUSES.has(delegation.status))
    .map(delegation => delegation.id)
    .sort()
    .join(',');

  useEffect(() => {
    const controllers = [];
    let active = true;
    const updateStatus = (id, status) => {
      setDelegationByConversation(current => {
        const targetId = Object.keys(current).find(key => current[key].id === id);
        if (!targetId) return current;
        const previous = current[targetId].status;
        if (TERMINAL_STATUSES.has(previous) || previous === status) return current;
        return { ...current, [targetId]: { ...current[targetId], status } };
      });
    };
    const pause = () => new Promise(resolve => setTimeout(resolve, 1500));

    for (const id of activeDelegationIds ? activeDelegationIds.split(',') : []) {
      const controller = new AbortController();
      controllers.push(controller);
      let cursor = '0';

      async function follow() {
        while (active) {
          try {
            const current = await client.delegations.get(id);
            if (!active) return;
            updateStatus(id, current.status);
            if (TERMINAL_STATUSES.has(current.status)) return;

            await client.delegations.events(id, {
              after: cursor,
              signal: controller.signal,
              onEvent: event => {
                if (!active) return;
                if (event.id) cursor = event.id;
                if (event.type === 'started') updateStatus(id, 'running');
                else if (TERMINAL_STATUSES.has(event.type)) updateStatus(id, event.type);
              },
            });

            const latest = await client.delegations.get(id);
            if (!active) return;
            updateStatus(id, latest.status);
            if (TERMINAL_STATUSES.has(latest.status)) return;
          } catch (error) {
            if (!active || error.name === 'AbortError') return;
          }
          if (active) await pause();
        }
      }

      void follow();
    }

    return () => {
      active = false;
      for (const controller of controllers) controller.abort();
    };
  }, [activeDelegationIds]);

  return { delegationByConversation, refreshDelegations };
}
