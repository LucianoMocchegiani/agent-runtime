import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { config } from '../config.js';
import type { AgentProfile, AgentProfileConfig } from './store.js';

let pool: Pool | undefined;
const FIELDS = ['chatSystemPrompt', 'contextTokenBudget', 'maxContextMessages', 'maxOutputTokens', 'reserveOutputTokens', 'contextSafetyTokens', 'maxToolSteps', 'llmTraceRequests', 'summariesEnabled', 'summaryTokenBudget'] as const;

export function setAgentProfilePool(value: Pool): void { pool = value; }
function db(): Pool { if (!pool) throw new Error('Agent profile store is not initialized'); return pool; }
function dto(row: any): AgentProfile {
  return { id: row.id, name: row.name, modelId: row.model_id, sortOrder: row.sort_order, config: row.config, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
function validate(name: unknown, modelId: unknown, sortOrder: unknown, rawConfig: unknown): { name: string; modelId: string; sortOrder: number; config: AgentProfileConfig } {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new Error('name debe tener entre 1 y 100 caracteres');
  if (typeof modelId !== 'string') throw new Error('modelId debe ser un string');
  if (modelId && !config.ai.providers[modelId.split('/')[0] as keyof typeof config.ai.providers]?.models.includes(modelId.slice(modelId.indexOf('/') + 1))) throw new Error('El modelo no está habilitado en la configuración del runtime');
  if (!Number.isSafeInteger(sortOrder) || (sortOrder as number) < 0) throw new Error('sortOrder debe ser un entero no negativo');
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) throw new Error('config debe ser un objeto');
  const c = rawConfig as Record<string, unknown>;
  for (const field of FIELDS) if (!Object.hasOwn(c, field)) throw new Error(`Falta ${field} en config`);
  for (const field of ['contextTokenBudget', 'maxContextMessages', 'maxOutputTokens', 'reserveOutputTokens', 'contextSafetyTokens', 'maxToolSteps', 'summaryTokenBudget'] as const) {
    if (!Number.isSafeInteger(c[field]) || (c[field] as number) < 1 || (c[field] as number) > 10_000_000) throw new Error(`${field} debe ser un entero positivo`);
  }
  if ((c.reserveOutputTokens as number) < (c.maxOutputTokens as number)) throw new Error('reserveOutputTokens debe ser mayor o igual que maxOutputTokens');
  if (typeof c.chatSystemPrompt !== 'string' || c.chatSystemPrompt.length > 100_000 || typeof c.llmTraceRequests !== 'boolean' || typeof c.summariesEnabled !== 'boolean') throw new Error('Configuración de agente inválida');
  return { name: name.trim(), modelId: modelId.trim(), sortOrder: sortOrder as number, config: Object.fromEntries(FIELDS.map((field) => [field, c[field]])) as AgentProfileConfig };
}

export async function listAgentProfiles(includeArchived = false): Promise<AgentProfile[]> {
  const result = await db().query(`SELECT * FROM runtime.agent_profile_configs ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY sort_order, created_at, id`);
  return result.rows.map(dto);
}
export async function getAgentProfile(id: string): Promise<AgentProfile | null> {
  const result = await db().query('SELECT * FROM runtime.agent_profile_configs WHERE id = $1 AND archived_at IS NULL', [id]);
  return result.rows[0] ? dto(result.rows[0]) : null;
}
export async function getDefaultAgentProfile(): Promise<AgentProfile> {
  const profiles = await listAgentProfiles();
  if (!profiles[0]) throw new Error('No hay perfiles de agente configurados');
  return profiles[0];
}
export async function createAgentProfile(input: { name: unknown; modelId: unknown; sortOrder: unknown; config: unknown }): Promise<AgentProfile> {
  const item = validate(input.name, input.modelId, input.sortOrder, input.config);
  const result = await db().query('INSERT INTO runtime.agent_profile_configs (id,name,model_id,sort_order,config) VALUES ($1,$2,$3,$4,$5) RETURNING *', [randomUUID(), item.name, item.modelId, item.sortOrder, JSON.stringify(item.config)]);
  return dto(result.rows[0]);
}
export async function updateAgentProfile(id: string, input: { name: unknown; modelId: unknown; sortOrder: unknown; config: unknown }): Promise<AgentProfile | null> {
  const item = validate(input.name, input.modelId, input.sortOrder, input.config);
  const result = await db().query('UPDATE runtime.agent_profile_configs SET name=$2,model_id=$3,sort_order=$4,config=$5,updated_at=now() WHERE id=$1 AND archived_at IS NULL RETURNING *', [id, item.name, item.modelId, item.sortOrder, JSON.stringify(item.config)]);
  return result.rows[0] ? dto(result.rows[0]) : null;
}
export async function activateAgentProfile(id: string): Promise<boolean> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('runtime.agent_profile_configs.activate'))");
    const profiles = await client.query<{ id: string }>(
      'SELECT id FROM runtime.agent_profile_configs WHERE archived_at IS NULL ORDER BY sort_order, created_at, id FOR UPDATE',
    );
    if (!profiles.rows.some((profile) => profile.id === id)) {
      await client.query('ROLLBACK');
      return false;
    }
    const reorderedIds = [id, ...profiles.rows.filter((profile) => profile.id !== id).map((profile) => profile.id)];
    for (const [sortOrder, profileId] of reorderedIds.entries()) {
      await client.query('UPDATE runtime.agent_profile_configs SET sort_order=$2,updated_at=now() WHERE id=$1', [profileId, sortOrder]);
    }
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
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
