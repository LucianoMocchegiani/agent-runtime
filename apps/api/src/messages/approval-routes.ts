import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../auth/contracts.js';
import { requireConversationId } from '../conversations/ids.js';
import { getConversation } from '../conversations/service.js';
import { readJsonBody } from '../http/request-body.js';
import { getMcpOAuthAccessToken } from '../mcp-oauth/service.js';
import { McpRegistry } from '../mcp/registry.js';
import { getAgentProfile } from '../runtime-config/agent-profiles.js';
import { getRuntimeSettings } from '../runtime-config/service.js';
import {
  cancelPendingToolApproval,
  claimPendingToolApproval,
  finishPendingToolApproval,
  getPendingToolApproval,
} from './approval-persistence.js';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HTTPException(400, { message: 'Body must be a JSON object' });
  }
  return value as Record<string, unknown>;
}

export const toolApprovalRoutes = new Hono<AppEnv>();

toolApprovalRoutes.post('/:messageId/approval', async (c) => {
  const conversationId = requireConversationId(c.req.param('id'));
  const messageId = c.req.param('messageId');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
    throw new HTTPException(400, { message: 'Identificador de mensaje inválido.' });
  }
  const body = asRecord(await readJsonBody(c.req.raw, 1_024));
  if (typeof body.approved !== 'boolean') {
    throw new HTTPException(400, { message: 'approved debe ser booleano.' });
  }
  const principal = c.get('principal');
  const pending = await getPendingToolApproval(conversationId, principal.userId, messageId);
  if (!body.approved) {
    if (!await cancelPendingToolApproval(conversationId, messageId)) {
      throw new HTTPException(409, { message: 'La aprobación ya fue procesada.' });
    }
    return c.json({ state: 'approval_cancelled' });
  }

  const conversation = await getConversation(principal, conversationId);
  if (conversation.archivedAt || !conversation.agentProfileId) {
    throw new HTTPException(409, { message: 'La conversación ya no está disponible.' });
  }
  const profile = await getAgentProfile(conversation.agentProfileId, true);
  if (!profile) throw new HTTPException(409, { message: 'El perfil asignado ya no está disponible.' });
  const settings = getRuntimeSettings(profile);
  const tokens = { ...(c.get('mcpAuth') ?? {}) };
  for (const [name, mcp] of Object.entries(settings.mcpConfig)) {
    if (!mcp.oauth) continue;
    const token = await getMcpOAuthAccessToken(principal.userId, name, settings.mcpConfig);
    if (token) tokens[name] = token;
  }

  const registry = new McpRegistry(settings.mcpConfig);
  try {
    await registry.connect(c.get('accessToken'), tokens);
    await registry.getAllTools();
    if (!registry.isUserOnlyTool(pending.toolName)) {
      throw new HTTPException(409, { message: 'La herramienta ya no está marcada para confirmación.' });
    }
    if (!pending.toolArgs || typeof pending.toolArgs !== 'object' || Array.isArray(pending.toolArgs)) {
      throw new HTTPException(409, { message: 'Los argumentos guardados de la acción no son válidos.' });
    }
    if (!await claimPendingToolApproval(conversationId, messageId)) {
      throw new HTTPException(409, { message: 'La aprobación ya fue procesada.' });
    }
    try {
      const result = await registry.callUserOnlyTool(
        pending.toolName,
        pending.toolArgs as Record<string, unknown>,
      );
      await finishPendingToolApproval(conversationId, messageId, result);
      return c.json({ state: 'completed', result });
    } catch (error) {
      await finishPendingToolApproval(conversationId, messageId, {
        error: 'La herramienta no pudo completarse.',
      });
      console.error('Falló la ejecución aprobada de una herramienta MCP.', error);
      throw new HTTPException(502, { message: 'La herramienta no pudo completarse.' });
    }
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('No se pudo preparar la ejecución aprobada de una herramienta MCP.', error);
    throw new HTTPException(502, { message: 'No se pudo ejecutar la herramienta aprobada.' });
  } finally {
    await registry.close().catch(() => undefined);
  }
});
