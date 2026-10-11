const activeTurns = new Set<string>();

/** Reserva un turno por usuario y conversación dentro de este proceso. */
export function acquireConversationTurn(userId: string, conversationId: string): (() => void) | null {
  const key = JSON.stringify([userId, conversationId]);
  if (activeTurns.has(key)) return null;

  activeTurns.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeTurns.delete(key);
  };
}
