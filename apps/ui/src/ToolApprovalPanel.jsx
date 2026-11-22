import { useState } from 'react';
import client from './client.js';
import styles from './ToolApprovalPanel.module.css';

export default function ToolApprovalPanel({ conversationId, messages, onResolved }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const pending = messages.filter((message) =>
    message.role === 'tool' && message.toolResult?.state === 'approval_pending'
  );
  if (!pending.length) return null;

  async function resolve(message, approved) {
    setBusyId(message.id);
    setError('');
    try {
      await client.messages.resolveToolApproval(conversationId, message.id, approved);
    } catch (e) {
      setError(e.message || 'No se pudo procesar la confirmación.');
    }
    await onResolved?.();
    setBusyId(null);
  }

  return (
    <section className={styles.panel} aria-label="Acciones que requieren confirmación">
      <h2 className={styles.heading}>Confirmación requerida</h2>
      {pending.map((message) => (
        <article className={styles.card} key={message.id}>
          <strong className={styles.toolName}>{message.toolName || 'Herramienta'}</strong>
          <p>El asistente solicita ejecutar esta acción. Revisá los argumentos antes de confirmar.</p>
          <pre className={styles.arguments}>{JSON.stringify(message.toolArgs, null, 2)}</pre>
          <div className={styles.actions}>
            <button type="button" disabled={busyId !== null} onClick={() => void resolve(message, true)}>
              Confirmar y ejecutar
            </button>
            <button type="button" disabled={busyId !== null} onClick={() => void resolve(message, false)}>
              Cancelar
            </button>
          </div>
        </article>
      ))}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
