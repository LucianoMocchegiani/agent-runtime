import { createClient } from 'agent-runtime-client/browser';

function getSessionId() {
  const key = 'chat_session_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function getBearer() {
  return `anon:${getSessionId()}`;
}

function getMcpAuth() {
  try {
    const raw = localStorage.getItem('chat_mcp_auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Vacío = mismo origen: la UI la sirve agent-runtime (o el proxy de Vite en dev).
const BASE_URL = import.meta.env.VITE_BASE_URL || '';

const client = createClient({
  baseUrl: BASE_URL,
  getBearer,
  getMcpAuth,
});

export default client;