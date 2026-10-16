import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AgentProfile, AgentProfileConfig, AgentProfileWrite } from './contracts.js';
import { DEFAULT_AGENT_PROFILE_NAME, DEFAULT_PROFILE_PREFERENCE_ID } from './constants.js';

let pool: Pool | undefined;

/** Configura el pool compartido antes de iniciar operaciones de perfiles. */
export async function initializeAgentProfilePersistence(value: Pool): Promise<void> {
  pool = value;
  await value.query(`CREATE TABLE IF NOT EXISTS runtime.agent_profile_configs (
    id text PRIMARY KEY,
    name text NOT NULL,
    model_id text NOT NULL,
    sort_order integer NOT NULL,
    config jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz NULL
  )`);
  await value.query(`CREATE TABLE IF NOT EXISTS runtime.agent_profile_preferences (
    id text PRIMARY KEY,
    default_profile_id text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}

function db(): Pool {
  if (!pool) throw new Error('Agent profile persistence is not initialized');
  return pool;
}

function toDomain(row: any): AgentProfile {
  return {
    id: row.id,
    name: row.name,
    modelId: row.model_id,
    config: row.config,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** Lee perfiles en orden de creación y omite los archivados salvo que se solicite. */
export async function readAgentProfiles(includeArchived = false): Promise<AgentProfile[]> {
  const result = await db().query(`SELECT * FROM runtime.agent_profile_configs ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY created_at, id`);
  return result.rows.map(toDomain);
}

/** Lee un perfil por id; los perfiles archivados quedan ocultos por defecto. */
export async function readAgentProfile(id: string, includeArchived = false): Promise<AgentProfile | null> {
  const result = await db().query(`SELECT * FROM runtime.agent_profile_configs WHERE id = $1 ${includeArchived ? '' : 'AND archived_at IS NULL'}`, [id]);
  return result.rows[0] ? toDomain(result.rows[0]) : null;
}

/** Obtiene el perfil activo más antiguo y falla si todavía no existe ninguno. */
export async function readFirstActiveAgentProfile(): Promise<AgentProfile> {
  const profiles = await readAgentProfiles();
  if (!profiles[0]) throw new Error('No hay perfiles de agente configurados');
  return profiles[0];
}

/** Lee el id del perfil predeterminado almacenado para las conversaciones nuevas. */
export async function readNewChatDefaultProfileId(): Promise<string | null> {
  const result = await db().query<{ default_profile_id: string }>(
    'SELECT default_profile_id FROM runtime.agent_profile_preferences WHERE id = $1',
    [DEFAULT_PROFILE_PREFERENCE_ID],
  );
  return result.rows[0]?.default_profile_id ?? null;
}

/** Guarda el perfil predeterminado de chats nuevos. */
export async function writeNewChatDefaultProfileId(profileId: string): Promise<void> {
  await db().query(
    'INSERT INTO runtime.agent_profile_preferences (id, default_profile_id) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET default_profile_id = EXCLUDED.default_profile_id, updated_at = now()',
    [DEFAULT_PROFILE_PREFERENCE_ID, profileId],
  );
}

/** Inicializa la preferencia predeterminada sin reemplazar una selección previa. */
export async function insertInitialDefaultProfile(profileId: string): Promise<void> {
  await db().query(
    'INSERT INTO runtime.agent_profile_preferences (id, default_profile_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
    [DEFAULT_PROFILE_PREFERENCE_ID, profileId],
  );
}

/** Inserta un perfil previamente validado y devuelve el registro persistido. */
export async function insertAgentProfile(input: AgentProfileWrite): Promise<AgentProfile> {
  const result = await db().query(
    'INSERT INTO runtime.agent_profile_configs (id,name,model_id,sort_order,config) VALUES ($1,$2,$3,0,$4) RETURNING *',
    [randomUUID(), input.name, input.modelId, JSON.stringify(input.config)],
  );
  return toDomain(result.rows[0]);
}

/** Actualiza un perfil activo y devuelve null si no existe o ya está archivado. */
export async function updateAgentProfileRecord(id: string, input: AgentProfileWrite): Promise<AgentProfile | null> {
  const result = await db().query(
    'UPDATE runtime.agent_profile_configs SET name=$2,model_id=$3,config=$4,updated_at=now() WHERE id=$1 AND archived_at IS NULL RETURNING *',
    [id, input.name, input.modelId, JSON.stringify(input.config)],
  );
  return result.rows[0] ? toDomain(result.rows[0]) : null;
}

/** Archiva un perfil en una transacción y conserva al menos uno activo y un default válido. */
export async function archiveAgentProfileRecord(id: string): Promise<boolean> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const profile = await client.query('SELECT id FROM runtime.agent_profile_configs WHERE id=$1 AND archived_at IS NULL FOR UPDATE', [id]);
    if (!profile.rows[0]) { await client.query('ROLLBACK'); return false; }
    const remaining = await client.query('SELECT count(*)::int AS count FROM runtime.agent_profile_configs WHERE archived_at IS NULL');
    if (remaining.rows[0].count <= 1) throw new Error('Debe quedar al menos un perfil activo');
    await client.query('UPDATE runtime.agent_profile_configs SET archived_at=now(),updated_at=now() WHERE id=$1', [id]);
    await client.query(
      `UPDATE runtime.agent_profile_preferences SET default_profile_id = (
        SELECT id FROM runtime.agent_profile_configs WHERE archived_at IS NULL
        ORDER BY created_at, id LIMIT 1
      ), updated_at=now() WHERE id=$1 AND default_profile_id=$2`,
      [DEFAULT_PROFILE_PREFERENCE_ID, id],
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Crea el perfil migrado solo en una instalación nueva, con exclusión entre réplicas. */
export async function seedLegacyAgentProfile(modelId: string, profileConfig: AgentProfileConfig): Promise<void> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('runtime.agent_profile_configs.seed'))");
    const exists = await client.query('SELECT 1 FROM runtime.agent_profile_configs LIMIT 1');
    if (exists.rowCount) {
      await client.query('COMMIT');
      return;
    }
    await client.query(
      'INSERT INTO runtime.agent_profile_configs (id,name,model_id,sort_order,config) VALUES ($1,$2,$3,0,$4)',
      [randomUUID(), DEFAULT_AGENT_PROFILE_NAME, modelId, JSON.stringify(profileConfig)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
