# Contrato HTTP

Base local: `http://localhost:3030`. Prefijo de API: `/v1`.

Header opcional para credenciales MCP por servidor: `X-MCP-Auth` (JSON, por ejemplo `{"mcp":"token"}`). Los turnos se transmiten como UI Message Stream del AI SDK. Los eventos de delegación usan SSE estándar.

## Identidad y autorización

Las rutas `/v1` asocian cada solicitud a una identidad. La URL de introspección y el mapeo del JSON de identidad se configuran de forma persistente y cifrada desde Administración → Auth (`runtime.config`), no mediante variables de entorno. Cuando hay URL, Runtime reenvía el Bearer opaco a ese endpoint con una solicitud GET y asigna la respuesta a `userId`, `email` y `name` según el mapeo configurado. Runtime no valida localmente firmas JWT. También acepta un token anónimo `anon:<uuid>` sin consultar el endpoint.

La UI ofrece `/auth/session` para administrar una sesión de navegador:

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| `GET` | `/auth/session` | — | `{ authenticated: boolean }` |
| `POST` | `/auth/session` | `{ token: "<Bearer opaco>" }` | Valida por introspección y establece cookie HttpOnly. |
| `DELETE` | `/auth/session` | — | Elimina la cookie y vuelve al acceso anónimo. |

La cookie `agent_runtime_access` es `HttpOnly`, `SameSite=Lax`, `Path=/` y `Secure` en `NODE_ENV=production`; no expone el Bearer a JavaScript ni lo persiste en Web Storage. Es una cookie de sesión del navegador. La UI la envía automáticamente y conserva por separado su UUID anónimo en `localStorage`, así que cerrar la sesión autenticada no elimina ni cambia la sesión anónima. Sirví la UI desde el mismo origen o desde otro origen del mismo sitio; para orígenes separados, permitilos mediante `CORS_ORIGIN` o `CORS_APP_DOMAIN`.

Sin URL de introspección, la API funciona en modo público: las solicitudes sin Bearer pueden acceder a `/v1` y reciben una identidad anónima aleatoria. Un Bearer opaco se rechaza con HTTP 401 (`Bearer authentication is not configured`), porque no puede validarse sin introspección. El Bearer `anon:<uuid>` sigue permitido y mantiene una identidad anónima estable; la UI nativa conserva ese valor en `localStorage`. Por tanto, dejar la URL vacía cambia la autenticación de todas las rutas `/v1`, no de una ruta aislada.

Un endpoint de introspección que rechace el token con HTTP 401/403 causa respuesta 401. Fallos de conexión, timeout (8 segundos), otros estados HTTP, JSON inválido o ausencia del campo configurado como `userId` causan 502. Las identidades válidas se almacenan en caché hasta 30 segundos; un cambio de URL o mapeo invalida esa caché.

El acceso a todas las rutas `/admin` admite dos métodos independientes: (1) cuenta local de recuperación con HTTP Basic (`admin/admin` por defecto, configurable mediante `RUNTIME_ADMIN_USERNAME` y `RUNTIME_ADMIN_PASSWORD`), que sigue funcionando si falla o no está configurado el auth externo; y (2) Bearer validado por introspección cuya identidad figure en `runtime_admins`. La lista dinámica se guarda en PostgreSQL y se administra desde Administradores; la API impide revocar al último administrador. Los emails no otorgan acceso. Para inicializar la autenticación externa y dar de alta su primer usuario habitual, usá `npm run admin:bootstrap -w apps/api -- <verified-user-id> --introspect-url <url>`. La pestaña Auth permite probar la URL y el mapeo con un Bearer suministrado para la prueba; no guarda ese token. Se aceptan URL HTTP y HTTPS: quien despliega es responsable de elegir un transporte apropiado para su red. **Cambiá admin/admin antes de exponer Runtime y usá TLS**, porque las credenciales locales no dependen del proveedor externo.

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

Las operaciones administrativas de perfiles están bajo `/admin/agent-profiles`. La administración de la allowlist persistida usa:

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/admin/runtime-admins` | Lista los IDs administradores y metadatos de alta. |
| `POST` | `/admin/runtime-admins` | Agrega `{ "userId": "…" }` (debe coincidir exactamente con un ID devuelto por introspección). |
| `DELETE` | `/admin/runtime-admins/:userId` | Revoca un ID; devuelve 409 si es el último administrador. |

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
