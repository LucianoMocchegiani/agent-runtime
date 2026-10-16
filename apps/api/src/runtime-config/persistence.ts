import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import type { RuntimeSettings } from './contracts.js';
import { ACTIVE_RUNTIME_CONFIG_ID, RUNTIME_CONFIG_DB_CONNECT_TIMEOUT_MS, RUNTIME_CONFIG_DB_POOL_MAX } from './constants.js';
import { initializeAgentProfilePersistence } from './agent-profile-persistence.js';

let pool: Pool | undefined;
let encryptionKey: Buffer | undefined;
let persistedVersion = 0;

type PersistedRuntimeConfig = { version: number; payload: unknown };

/** Error de persistencia que indica una escritura basada en una versión obsoleta. */
export class RuntimeConfigPersistenceConflictError extends Error {
  constructor() {
    super('Runtime config version conflict');
    this.name = 'RuntimeConfigPersistenceConflictError';
  }
}

function encrypt(value: unknown): object {
  if (!encryptionKey) throw new Error('Runtime config encryption is disabled');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(value: unknown): unknown {
  const encrypted = value as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
  if (!encryptionKey || encrypted?.v !== 1 || typeof encrypted.iv !== 'string' || typeof encrypted.tag !== 'string' || typeof encrypted.data !== 'string') {
    throw new Error('Invalid encrypted runtime config');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'base64')), decipher.final()]).toString('utf8')) as unknown;
}

function db(): Pool {
  if (!pool) throw new Error('Runtime config persistence is not initialized');
  return pool;
}

/** Inicializa conexiones y tablas, inserta los valores iniciales y entrega la versión almacenada. */
export async function startRuntimeConfigPersistence(initialSettings: RuntimeSettings): Promise<PersistedRuntimeConfig> {
  const url = process.env.DATABASE_URL?.trim();
  const rawKey = process.env.RUNTIME_CONFIG_ENCRYPTION_KEY?.trim();
  if (!url || !rawKey) {
    throw new Error('DATABASE_URL and RUNTIME_CONFIG_ENCRYPTION_KEY are required for persistent runtime infrastructure settings');
  }
  encryptionKey = /^[\da-f]{64}$/i.test(rawKey) ? Buffer.from(rawKey, 'hex') : createHash('sha256').update(rawKey).digest();
  const connectionUrl = new URL(url);
  connectionUrl.searchParams.delete('schema');
  pool = new Pool({ connectionString: connectionUrl.toString(), max: RUNTIME_CONFIG_DB_POOL_MAX, connectionTimeoutMillis: RUNTIME_CONFIG_DB_CONNECT_TIMEOUT_MS });
  await pool.query('CREATE SCHEMA IF NOT EXISTS runtime');
  await pool.query('CREATE TABLE IF NOT EXISTS runtime.config (id text PRIMARY KEY, version integer NOT NULL, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('CREATE TABLE IF NOT EXISTS runtime.config_history (id text NOT NULL, version integer NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (id, version))');
  const existing = await pool.query('SELECT 1 FROM runtime.config WHERE id = $1', [ACTIVE_RUNTIME_CONFIG_ID]);
  if (existing.rowCount === 0) {
    const encrypted = JSON.stringify(encrypt(initialSettings));
    await pool.query(
      'INSERT INTO runtime.config (id, version, payload) VALUES ($1, 1, $2) ON CONFLICT (id) DO NOTHING',
      [ACTIVE_RUNTIME_CONFIG_ID, encrypted],
    );
  }
  await pool.query(
    'INSERT INTO runtime.config_history (id, version, payload) SELECT id, version, payload FROM runtime.config WHERE id = $1 ON CONFLICT DO NOTHING',
    [ACTIVE_RUNTIME_CONFIG_ID],
  );
  const loaded = await loadRuntimeConfig();
  await initializeAgentProfilePersistence(pool);
  return loaded;
}

/** Lee y descifra la versión actual; permite sincronizar cambios guardados por otras réplicas. */
export async function loadRuntimeConfig(): Promise<PersistedRuntimeConfig> {
  const result = await db().query<{ version: number; payload: unknown }>(
    'SELECT version, payload FROM runtime.config WHERE id = $1', [ACTIVE_RUNTIME_CONFIG_ID],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Runtime config has not been initialized');
  persistedVersion = row.version;
  return { version: row.version, payload: decrypt(row.payload) };
}

/** Guarda ajustes cifrados mediante control optimista y valida que los perfiles sigan disponibles. */
export async function saveRuntimeConfig(
  settings: RuntimeSettings,
  expectedVersion: number | undefined,
  availableModels: ReadonlySet<string>,
): Promise<number> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const profiles = await client.query<{ id: string; name: string; model_id: string }>(
      "SELECT id, name, model_id FROM runtime.agent_profile_configs WHERE archived_at IS NULL AND model_id <> '' FOR SHARE",
    );
    for (const profile of profiles.rows) {
      if (!availableModels.has(profile.model_id)) {
        throw new Error(`No se puede deshabilitar ${profile.model_id}: está asignado al perfil «${profile.name}»`);
      }
    }
    const current = await client.query<{ version: number }>(
      'SELECT version FROM runtime.config WHERE id = $1 FOR UPDATE', [ACTIVE_RUNTIME_CONFIG_ID],
    );
    const previousVersion = current.rows[0]?.version;
    if (previousVersion === undefined) throw new Error('Runtime config has not been initialized');
    if (expectedVersion !== undefined && expectedVersion !== previousVersion) throw new RuntimeConfigPersistenceConflictError();
    const nextVersion = previousVersion + 1;
    const payload = JSON.stringify(encrypt(settings));
    await client.query('UPDATE runtime.config SET version = $1, payload = $2, updated_at = now() WHERE id = $3', [nextVersion, payload, ACTIVE_RUNTIME_CONFIG_ID]);
    await client.query('INSERT INTO runtime.config_history (id, version, payload) VALUES ($1, $2, $3)', [ACTIVE_RUNTIME_CONFIG_ID, nextVersion, payload]);
    await client.query('COMMIT');
    persistedVersion = nextVersion;
    return nextVersion;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Asigna el primer perfil activo a las conversaciones heredadas sin perfil explícito. */
export async function assignLegacyConversationsToDefaultProfile(): Promise<void> {
  await db().query(`UPDATE public.conversations SET agent_profile_id = (
    SELECT id FROM runtime.agent_profile_configs WHERE archived_at IS NULL
    ORDER BY created_at, id LIMIT 1
  ) WHERE agent_profile_id IS NULL`);
  const unassigned = await db().query<{ count: string }>(
    'SELECT count(*)::text AS count FROM public.conversations WHERE agent_profile_id IS NULL',
  );
  if (Number(unassigned.rows[0]?.count ?? 0) > 0) {
    throw new Error('No se pudieron asignar perfiles a todas las conversaciones existentes; verificá que haya un perfil activo.');
  }
}

/** Devuelve la última versión que esta réplica cargó o persistió. */
export function getPersistedRuntimeConfigVersion(): number { return persistedVersion; }

/** Indica si el pool y la clave de cifrado están inicializados. */
export function isRuntimeConfigPersistenceEnabled(): boolean { return pool !== undefined && encryptionKey !== undefined; }
