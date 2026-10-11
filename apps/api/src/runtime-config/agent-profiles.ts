import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { config } from '../config.js';
import type { AgentProfile, AgentProfileConfig } from './store.js';

let pool: Pool | undefined;
const FIELDS = ['chatSystemPrompt', 'contextTokenBudget', 'maxContextMessages', 'maxOutputTokens', 'reserveOutputTokens', 'contextSafetyTokens', 'maxToolSteps', 'llmTraceRequests', 'summariesEnabled', 'summaryTokenBudget'] as const;

export function setAgentProfilePool(value: Pool): void { pool = value; }
function db(): Pool { if (!pool) throw new Error('Agent profile store is not initialized'); return pool; }
function dto(row: any): AgentProfile {
  return { id: row.id, name: row.name, modelId: row.model_id, config: row.config, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
function validate(name: unknown, modelId: unknown, rawConfig: unknown): { name: string; modelId: string; config: AgentProfileConfig } {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new Error('name debe tener entre 1 y 100 caracteres');
  if (typeof modelId !== 'string') throw new Error('modelId debe ser un string');
  if (modelId && !config.ai.providers[modelId.split('/')[0] as keyof typeof config.ai.providers]?.models.includes(modelId.slice(modelId.indexOf('/') + 1))) throw new Error('El modelo no está habilitado en la configuración del runtime');
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) throw new Error('config debe ser un objeto');
  const c = rawConfig as Record<string, unknown>;
  for (const field of FIELDS) if (!Object.hasOwn(c, field)) throw new Error(`Falta ${field} en config`);
  for (const field of ['contextTokenBudget', 'maxContextMessages', 'maxOutputTokens', 'reserveOutputTokens', 'contextSafetyTokens', 'maxToolSteps', 'summaryTokenBudget'] as const) {
    if (!Number.isSafeInteger(c[field]) || (c[field] as number) < 1 || (c[field] as number) > 10_000_000) throw new Error(`${field} debe ser un entero positivo`);
  }
  if ((c.reserveOutputTokens as number) < (c.maxOutputTokens as number)) throw new Error('reserveOutputTokens debe ser mayor o igual que maxOutputTokens');
  if (typeof c.chatSystemPrompt !== 'string' || c.chatSystemPrompt.length > 100_000 || typeof c.llmTraceRequests !== 'boolean' || typeof c.summariesEnabled !== 'boolean') throw new Error('Configuración de agente inválida');
  return { name: name.trim(), modelId: modelId.trim(), config: Object.fromEntries(FIELDS.map((field) => [field, c[field]])) as AgentProfileConfig };
}

export async function listAgentProfiles(includeArchived = false): Promise<AgentProfile[]> {
  const result = await db().query(`SELECT * FROM runtime.agent_profile_configs ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY created_at, id`);
  return result.rows.map(dto);
}
export async function getAgentProfile(id: string, includeArchived = false): Promise<AgentProfile | null> {
  const result = await db().query(`SELECT * FROM runtime.agent_profile_configs WHERE id = $1 ${includeArchived ? '' : 'AND archived_at IS NULL'}`, [id]);
  return result.rows[0] ? dto(result.rows[0]) : null;
}
export async function getFirstActiveAgentProfile(): Promise<AgentProfile> {
  const profiles = await listAgentProfiles();
  if (!profiles[0]) throw new Error('No hay perfiles de agente configurados');
  return profiles[0];
}

/** Perfil configurado para los chats nuevos. */
export async function getNewChatDefaultProfileId(): Promise<string> {
  const result = await db().query<{ default_profile_id: string }>(
    "SELECT default_profile_id FROM runtime.agent_profile_preferences WHERE id = 'default'",
  );
  const selectedId = result.rows[0]?.default_profile_id;
  if (selectedId && await getAgentProfile(selectedId)) return selectedId;
  return (await getFirstActiveAgentProfile()).id;
}

export async function setNewChatDefaultProfileId(profileId: string): Promise<boolean> {
  if (!await getAgentProfile(profileId)) return false;
  await db().query(
    "INSERT INTO runtime.agent_profile_preferences (id, default_profile_id) VALUES ('default', $1) ON CONFLICT (id) DO UPDATE SET default_profile_id = EXCLUDED.default_profile_id, updated_at = now()",
    [profileId],
  );
  return true;
}

export async function initializeNewChatDefaultProfile(): Promise<void> {
  const first = await getFirstActiveAgentProfile();
  await db().query(
    "INSERT INTO runtime.agent_profile_preferences (id, default_profile_id) VALUES ('default', $1) ON CONFLICT (id) DO NOTHING",
    [first.id],
  );
}

/** Resuelve el perfil configurado para los chats nuevos. */
export async function getNewChatDefaultAgentProfile(): Promise<AgentProfile> {
  return (await getAgentProfile(await getNewChatDefaultProfileId())) ?? getFirstActiveAgentProfile();
}
export async function createAgentProfile(input: { name: unknown; modelId: unknown; config: unknown }): Promise<AgentProfile> {
  const item = validate(input.name, input.modelId, input.config);
  // sort_order remains in the table for existing installations, but no longer carries behavior.
  const result = await db().query('INSERT INTO runtime.agent_profile_configs (id,name,model_id,sort_order,config) VALUES ($1,$2,$3,0,$4) RETURNING *', [randomUUID(), item.name, item.modelId, JSON.stringify(item.config)]);
  return dto(result.rows[0]);
}
export async function updateAgentProfile(id: string, input: { name: unknown; modelId: unknown; config: unknown }): Promise<AgentProfile | null> {
  const item = validate(input.name, input.modelId, input.config);
  const result = await db().query('UPDATE runtime.agent_profile_configs SET name=$2,model_id=$3,config=$4,updated_at=now() WHERE id=$1 AND archived_at IS NULL RETURNING *', [id, item.name, item.modelId, JSON.stringify(item.config)]);
  return result.rows[0] ? dto(result.rows[0]) : null;
}
export async function archiveAgentProfile(id: string): Promise<boolean> {
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
      ), updated_at=now() WHERE id='default' AND default_profile_id=$1`,
      [id],
    );
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** Migra el comportamiento preexistente al primer perfil, una sola vez. */
export async function seedDefaultAgentProfile(): Promise<void> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Avoid creating multiple competing first profiles when API replicas start together.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('runtime.agent_profile_configs.seed'))");
    const exists = await client.query('SELECT 1 FROM runtime.agent_profile_configs LIMIT 1');
    if (exists.rowCount) {
      await client.query('COMMIT');
      return;
    }
    const legacyConfig: AgentProfileConfig = {
      chatSystemPrompt: config.chatSystemPrompt, contextTokenBudget: config.contextTokenBudget,
      maxContextMessages: config.maxContextMessages, maxOutputTokens: config.maxOutputTokens,
      reserveOutputTokens: config.reserveOutputTokens, contextSafetyTokens: config.contextSafetyTokens,
      maxToolSteps: config.maxToolSteps, llmTraceRequests: config.llmTraceRequests,
      summariesEnabled: config.summariesEnabled, summaryTokenBudget: config.summaryTokenBudget,
    };
    await client.query('INSERT INTO runtime.agent_profile_configs (id,name,model_id,sort_order,config) VALUES ($1,$2,$3,0,$4)', [randomUUID(), 'Predeterminado', config.ai.defaultModel, JSON.stringify(legacyConfig)]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
