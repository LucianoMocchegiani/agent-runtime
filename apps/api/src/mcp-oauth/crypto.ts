import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_ENV = 'MCP_OAUTH_ENCRYPTION_KEY';

type SealedToken = { ciphertext: Buffer; nonce: Buffer; tag: Buffer };

function encryptionKey(): Buffer {
  const raw = process.env[KEY_ENV]?.trim();
  if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error(`${KEY_ENV} debe estar configurada con exactamente 64 caracteres hexadecimales (32 bytes).`);
  }
  return Buffer.from(raw, 'hex');
}

export function assertOAuthEncryptionConfigured(): void {
  encryptionKey();
}

export function sealOAuthToken(token: string): SealedToken {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

export function openOAuthToken(sealed: SealedToken): string {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), sealed.nonce);
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
}
