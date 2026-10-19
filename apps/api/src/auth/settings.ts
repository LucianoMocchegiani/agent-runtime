import type { AuthMapping } from '../config.js';

export type AuthSettings = {
  authIntrospectUrl: string | null;
  authMapping: AuthMapping;
};

const DEFAULT_AUTH_MAPPING: AuthMapping = { userId: 'userId', email: null, name: null };

/** Valida y normaliza la configuración de introspección, tanto persistida como enviada por administración. */
export function validateAuthSettings(value: unknown): AuthSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Auth settings must be an object');
  }
  const input = value as Record<string, unknown>;
  const rawUrl = input.authIntrospectUrl;
  if (rawUrl !== undefined && rawUrl !== null && typeof rawUrl !== 'string') {
    throw new Error('authIntrospectUrl must be a string or null');
  }
  const authIntrospectUrl = typeof rawUrl === 'string' && rawUrl.trim() ? rawUrl.trim() : null;
  if (authIntrospectUrl) {
    let url: URL;
    try { url = new URL(authIntrospectUrl); } catch { throw new Error('Invalid authIntrospectUrl'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('authIntrospectUrl must use HTTP or HTTPS');
  }

  const rawMapping = input.authMapping;
  if (rawMapping === undefined) return { authIntrospectUrl, authMapping: { ...DEFAULT_AUTH_MAPPING } };
  if (!rawMapping || typeof rawMapping !== 'object' || Array.isArray(rawMapping)) {
    throw new Error('authMapping must be an object');
  }
  const mapping = rawMapping as Record<string, unknown>;
  if (typeof mapping.userId !== 'string' || !mapping.userId.trim()) {
    throw new Error('authMapping.userId must be a non-empty field name');
  }
  for (const field of ['email', 'name'] as const) {
    if (mapping[field] !== undefined && mapping[field] !== null && (typeof mapping[field] !== 'string' || !mapping[field].trim())) {
      throw new Error(`authMapping.${field} must be a non-empty field name or null`);
    }
  }
  return {
    authIntrospectUrl,
    authMapping: {
      userId: mapping.userId.trim(),
      email: typeof mapping.email === 'string' ? mapping.email.trim() : null,
      name: typeof mapping.name === 'string' ? mapping.name.trim() : null,
    },
  };
}
