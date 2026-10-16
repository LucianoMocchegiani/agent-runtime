/** Estados válidos del ciclo de vida de una delegación persistida. */
export type DelegationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';

/** Datos de ejecución cifrados mientras una delegación espera al worker. */
export type DelegationPayload = {
  principal: import('../auth/contracts.js').Principal;
  accessToken: string;
  mcpTokens: Record<string, string> | null;
  instruction: string;
};

/** Trabajo reclamado por un worker, incluidos los bytes cifrados del payload. */
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

/** Evento persistido y transmitido a los clientes de una delegación. */
export type DelegationEvent = {
  id: string;
  jobId: string;
  type: string;
  data: unknown;
  createdAt: Date;
};

/** Vista pública de una delegación; excluye credenciales y payloads cifrados. */
export type DelegationSummary = {
  id: string;
  status: DelegationStatus;
  sourceConversationId: string;
  targetConversationId: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorCode: string | null;
};
