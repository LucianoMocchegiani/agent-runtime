const STORAGE_KEY = 'chat_bearer_token';

export function normalizeBearerToken(value) {
  const input = String(value ?? '').trim();
  const token = /^Bearer(?:\s+|$)/i.test(input) ? input.replace(/^Bearer\s*/i, '').trim() : input;
  if (!token) throw new Error('Pegá un Bearer token para continuar.');
  if (/\s/.test(token)) throw new Error('El token no puede contener espacios ni saltos de línea.');
  return token;
}

export function getStoredBearerToken() {
  try {
    return globalThis.sessionStorage?.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function hasStoredBearerToken() {
  return Boolean(getStoredBearerToken());
}

export function setStoredBearerToken(value) {
  const token = normalizeBearerToken(value);
  let storage;
  try {
    storage = globalThis.sessionStorage;
  } catch {
    throw new Error('El almacenamiento de sesión no está disponible en este navegador.');
  }
  if (!storage) throw new Error('El almacenamiento de sesión no está disponible en este navegador.');
  try {
    storage.setItem(STORAGE_KEY, token);
  } catch {
    throw new Error('No se pudo guardar el token en el almacenamiento de sesión del navegador.');
  }
}

export function clearStoredBearerToken() {
  try {
    globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    throw new Error('No se pudo borrar el token del almacenamiento de sesión del navegador.');
  }
}
