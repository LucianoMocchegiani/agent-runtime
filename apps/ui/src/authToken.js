import client from './client.js';

export function normalizeBearerToken(value) {
  const input = String(value ?? '').trim();
  const token = /^Bearer(?:\s+|$)/i.test(input) ? input.replace(/^Bearer\s*/i, '').trim() : input;
  if (!token) throw new Error('Pegá un Bearer token para continuar.');
  if (/\s/.test(token)) throw new Error('El token no puede contener espacios ni saltos de línea.');
  return token;
}

async function requestSession(request) {
  try {
    return await request();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('No se pudo conectar con Agent Runtime para actualizar la sesión.');
    }
    throw error;
  }
}

export async function getAuthSession() {
  return requestSession(() => client.authSession.get());
}

export async function setStoredBearerToken(value) {
  const token = normalizeBearerToken(value);
  return requestSession(() => client.authSession.set(token));
}

export async function clearStoredBearerToken() {
  return requestSession(() => client.authSession.clear());
}
