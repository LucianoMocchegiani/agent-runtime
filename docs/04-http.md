# Contrato HTTP

Base local: `http://localhost:3010`. Prefijo de API: `/v1`. Colección Postman del monorepo: `postman/` (reusa `accessToken` del login del huésped).

Header de stream (el drawer lo manda): `x-vercel-ai-ui-message-stream`.

Header opcional para MCP tokens: `X-MCP-Auth` (JSON `{"mcp":"token"}`).

## Autenticado (`Authorization: Bearer`)

JWT identificado o `anon:<uuid>`. El middleware aplica a todo `/v1`. Sin Bearer → session anónima nueva por request.

### Conversaciones

| Método | Ruta | Body | Respuesta |
|--------|------|------|-----------|
| `GET` | `/v1/conversations` | — | `{ items: Conversation[] }` activos. `?archived=true` → archivados. Máx. 100. |
| `POST` | `/v1/conversations` | `{ title?: string \| null }` | 201 conversación. |
| `GET` | `/v1/conversations/:id` | — | Una conversación (dueño). |
| `PATCH` | `/v1/conversations/:id` | `{ title?, archived?: boolean }` | Actualizada. |
| `DELETE` | `/v1/conversations/:id` | — | Archivada (`archivedAt` set). |

`:id` = UUID. Título máx. 200 chars.

`Conversation`: `id`, `userId`, `title`, `archivedAt`, `createdAt`, `updatedAt` (ISO).

### Mensajes

| Método | Ruta | Body | Respuesta |
|--------|------|------|-----------|
| `GET` | `/v1/conversations/:id/messages` | — | `{ items: Message[] }` cronológico, máx. 500. |
| `POST` | `/v1/conversations/:id/messages` | `{ text: string }` | **UI Message Stream** (no JSON de chat). Texto 1–100.000 caracteres. |

`Message`: `id`, `conversationId`, `role`, `content`, `toolName`, `toolArgs`, `toolResult`, `createdAt`.

Errores JSON: `{ "error": "…" }` con status 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503 | 500.

[← Flujos](./03-flujos.md) · [Índice](./00-indice.md)
