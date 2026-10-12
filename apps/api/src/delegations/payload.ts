import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_ENV = 'DELEGATION_PAYLOAD_ENCRYPTION_KEY';

type SealedPayload = {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
};

function encryptionKey(): Buffer | null {
  const raw = process.env[KEY_ENV]?.trim();
  if (!raw) return null;
  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error(`${KEY_ENV} debe tener exactamente 64 caracteres hexadecimales (32 bytes).`);
  }
  return Buffer.from(raw, 'hex');
}

export function delegationEncryptionEnabled(): boolean {
  return encryptionKey() !== null;
}

export function sealDelegationPayload(value: unknown): SealedPayload {
  const key = encryptionKey();
  if (!key) throw new Error(`${KEY_ENV} no está configurada; las delegaciones están deshabilitadas.`);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

export function openDelegationPayload<T>(sealed: SealedPayload): T {
  const key = encryptionKey();
  if (!key) throw new Error(`${KEY_ENV} no está configurada; no se puede procesar la delegación.`);
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce);
  decipher.setAuthTag(sealed.tag);
  const plaintext = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as T;
}
