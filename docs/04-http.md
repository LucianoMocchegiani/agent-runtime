# Contrato HTTP

Base local: `http://localhost:3010`. Prefijo de API: `/v1`.

Header opcional para credenciales MCP por servidor: `X-MCP-Auth` (JSON, por ejemplo `{"mcp":"token"}`). Los turnos se transmiten como UI Message Stream del AI SDK. Los eventos de delegación usan SSE estándar.

## Identidad y autorización

Las rutas `/v1` asocian cada solicitud a una identidad. Si `AUTH_INTROSPECT_URL` está configurada, el middleware resuelve allí el token del sistema huésped; también acepta un token anónimo `anon:<uuid>`. Si `AUTH_INTROSPECT_URL` está vacía, la API funciona en modo público: cualquier solicitud puede acceder a `/v1` y recibe una identidad anónima aleatoria (los Bearer opacos se ignoran). La UI nativa conserva un token `anon:<uuid>` en `localStorage` para mantener la identidad entre solicitudes. Sin ese token, se crea una identidad nueva por solicitud y no se pueden recuperar conversaciones en solicitudes posteriores.

El modo público no configura CORS automáticamente: para permitir llamadas desde una UI alojada en otro origen, configurá `CORS_ORIGIN` o `CORS_APP_DOMAIN`.

Las rutas administrativas están bajo `/admin` y tienen autorización propia. La UI y las rutas de administración no sustituyen la autenticación y autorización del sistema huésped.

## Conversaciones

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| `GET` | `/v1/conversations` | — | `{ items: Conversation[] }`; `?archived=true` lista archivadas. |
| `POST` | `/v1/conversations` | `{ title?: string \| null, agentProfileId?: string \| null }` | 201 y conversación creada. Si se omite el perfil, usa el predeterminado para chats nuevos. |
| `GET` | `/v1/conversations/:id` | — | Conversación del usuario autenticado. |
| `PATCH` | `/v1/conversations/:id` | `{ title?, archived?: boolean, agentProfileId?: string \| null }` | Conversación actualizada. `agentProfileId: null` selecciona el predeterminado actual. |
| `DELETE` | `/v1/conversations/:id` | — | Archiva la conversación. |

`:id` es UUID. El título admite hasta 200 caracteres. El perfil queda asignado a la conversación y determina los turnos siguientes.

## Mensajes

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| `GET` | `/v1/conversations/:id/messages` | `?limit=1..100&beforeCreatedAt=...&beforeId=...` | Página cronológica `{ items, hasMore, nextCursor }`. Enviar juntos ambos campos del cursor. |
| `POST` | `/v1/conversations/:id/messages` | `{ text?: string, image?: string, images?: string[] }` | UI Message Stream. Acepta hasta 10 imágenes de 5 MiB cada una (JPEG, PNG, WebP o GIF); las imágenes no se persisten. |

El texto puede tener hasta 100.000 caracteres. Enviar `model` en el body no está soportado: el modelo se obtiene del perfil asignado al hilo.

## Perfiles y modelos

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/agent-profiles` | Lista perfiles activos disponibles para el usuario. |
| `GET` | `/v1/models` | Lista modelos habilitados y el modelo predeterminado. |

Las operaciones administrativas de perfiles están bajo `/admin/agent-profiles`.

## Delegaciones

Disponibles solo si `DELEGATION_PAYLOAD_ENCRYPTION_KEY` está configurada.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/delegations` | Lista delegaciones del usuario. |
| `GET` | `/v1/delegations/:id` | Consulta estado. |
| `GET` | `/v1/delegations/:id/events` | SSE recuperable; acepta `Last-Event-ID` o `?after=<cursor>`. |

Los estados son `queued`, `running`, `completed`, `failed` e `interrupted`. Ver [README](../README.md#delegaciones-entre-conversaciones) para semántica y límites de reintento.

Errores JSON: `{ "error": "…" }`. Según la ruta, se usan estados HTTP 400, 401, 403, 404, 409, 413, 429, 500, 502 o 503.

[← Flujos](./03-flujos.md) · [Índice](./00-indice.md)
