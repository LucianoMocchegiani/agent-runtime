# Módulos de la API (`apps/api/src/`)

No es un monolito por bounded context. Es un servicio chico partido por **capa técnica del chat**. Cada carpeta es un módulo con un trabajo claro. La API no persiste conversaciones ni mensajes: eso vive en Memory MCP. Sí administra la configuración funcional cifrada y versionada en PostgreSQL, bajo `runtime.config`.

```text
src/
  index.ts          arranque HTTP
  app.ts            Hono: CORS, /health, /v1 autenticado, UI en /
  config.ts         infraestructura/env y seed mínimo de runtime
  runtime-config/   configuración cifrada, validación y API administrativa
  cors.ts           allowlist + *.localhost + CORS_APP_DOMAIN
  ui.ts             UI nativa (apps/ui/dist) + fallback SPA
  auth/             quién sos
  conversations/    hilos
  messages/         HTTP de mensajes
  agent/            un turno LLM + tools
  mcp/              pool MCP multi-conexión
  memory/           cliente del Memory MCP
  llm/              proveedores + errores para humanos
```

## Arranque y HTTP

| Archivo | Qué hace |
|---------|----------|
| `index.ts` | `serve` en `PORT` (default 3010). |
| `app.ts` | CORS; `GET /health` (handshake MCP con el Memory MCP, timeout 3 s); monta `/v1` con `requirePrincipal`, conversaciones, mensajes y modelos. `onError` serializa `HTTPException`. |
| `config.ts` | Lee solo infraestructura/env de ejecución. Define el seed funcional mínimo; la API crea `runtime.config` y arranca incluso sin provider de IA. |
| `cors.ts` | Refleja `Origin` si está en `CORS_ORIGIN`, es `*.localhost` o cae bajo `CORS_APP_DOMAIN`. |

`/health` no pide Bearer. Si el Memory MCP no responde: `503` y `status: degraded`.

## `auth/` — identidad portable

| Archivo | Qué hace |
|---------|----------|
| `principal.ts` | Tipo `Principal` (`userId`, email/name). `AppEnv` de Hono (`principal`, `accessToken`, `mcpAuth`). |
| `introspect.ts` | Reenvía Bearer a `AUTH_INTROSPECT_URL`. Mapea campos con `AUTH_MAPPING`. Exige `userId`. Cache in-memory 30 s / 256 entradas. |
| `middleware.ts` | Lee `Authorization: Bearer`. `anon:<uuid>` → ese uuid es el `userId`. Otro token → introspect. Sin token → uuid nuevo. Sin estado: no persiste sesiones ni identidades. `OPTIONS` pasa. |

**Invariante:** el dueño del hilo es el principal del middleware. Las rutas no aceptan `userId` en el body.

## `conversations/` — CRUD de hilos

| Archivo | Qué hace |
|---------|----------|
| `routes.ts` | `GET/POST /`, `GET/PATCH/DELETE /:id`. Query `archived=true` lista archivados. |
| `service.ts` | Delega en el Memory MCP con el `userId` del principal. Create/list/get/update/archive. Título máx. 200. |
| `ids.ts` | UUID de ruta o 400. |

`DELETE` no borra filas: setea `archived_at`.

## `messages/` — historial y disparo del turno

| Archivo | Qué hace |
|---------|----------|
| `routes.ts` | `GET /` lista DTOs. `POST /` valida texto (1–100.000), niega archivado (409), llama `streamAgentTurn`. |

El `POST` no espera un JSON de respuesta de chat: **devuelve el stream** del AI SDK.

## `agent/` — un turno

| Archivo | Qué hace |
|---------|----------|
| `run.ts` | Abre MCP con `runtime.config.mcpConfig` + `X-MCP-Auth`, lista tools, persiste user, título automático, arma historial, `streamText`, persiste tools + assistant al terminar / abortar / error. Cierra el cliente MCP una vez. |
| `window.ts` | Recorte de prompt (tokens + shrink de tools viejas). |

Abort del cliente (`AbortSignal` del request): corta el LLM y guarda lo ya generado (`onAbort` / `onError`).

## `mcp/` — pool MCP

| Archivo | Qué hace |
|---------|----------|
| `registry.ts` | `McpRegistry` con pool de clientes. `connect(accessToken, mcpTokens)`. Tools namespaced (`mcpName__toolName`: OpenAI no acepta puntos). |

Cada entrada de `runtime.config.mcpConfig` define un MCP con `url`, `auth`, `headers` y `optional`. Con `auth`, el runtime reenvía el Bearer del usuario (o el de `X-MCP-Auth`) y cada MCP valida. `headers` son fijos del servidor (secretos de MCPs propios, como `pc-mcp`).

Si un MCP requerido no arranca o `tools()` falla → **502**. Uno `optional` se saltea con un warning en el log.

## `memory/` — cliente del Memory MCP

| Archivo | Qué hace |
|---------|----------|
| `client.ts` | Adapter MCP client de `MemoryMcp` (`MEMORY_MCP_URL`). Valida que existan las tools del contrato. |
| `errors.ts` | `MemoryError` / `MemoryUnavailableError`. |

El contrato (nombres de tools, DTOs, interfaz `MemoryMcp`) vive en `packages/memory-contract`.

## Memory MCP default (`apps/memory-mcp/src/`)

Otro proceso, otra imagen (`--target memory-mcp`). Único dueño de la DB `memory`.

| Archivo | Qué hace |
|---------|----------|
| `index.ts` | `serve` en `MEMORY_MCP_HOST:MEMORY_MCP_PORT` (default `127.0.0.1:3012`). |
| `server.ts` | Hono + McpServer stateless (uno por request). `/health` y `/mcp`. Registra las tools del contrato. |
| `tools.ts` | Persistencia Prisma de conversaciones y mensajes. Ownership check por `userId`. `applyAutomaticTitle` solo si `title IS NULL`. |
| `preferences.ts` | Preferencias propias por usuario: guardar/listar/eliminar y recuperar coincidencias híbridas con embeddings o texto. |
| `search/` | Búsqueda e indexación de mensajes y proveedor de embeddings compartido. |
| `title.ts` | Primer mensaje → una línea, máx. 60 chars + `…`. Sin LLM. Vacío → `Nuevo chat`. |
| `setup-db.ts` | Crea la database si no existe y corre `prisma migrate deploy`. |
| `config.ts` | Solo `DATABASE_URL`, `MEMORY_MCP_HOST`, `MEMORY_MCP_PORT`. |

## `llm/` — proveedor

| Archivo | Qué hace |
|---------|----------|
| `provider.ts` | `listModels()` y `resolveModel("proveedor/modelo")` contra los providers guardados en runtime.config; cachea un modelo por id. |
| `routes.ts` | `GET /v1/models` → `{ default, items }` para el selector del cliente. |
| `openai.ts` / `openrouter.ts` | Un adapter por proveedor: `(apiKey, model) → LanguageModel`. |
| `errors.ts` | Mapea 402/401/429/contexto/timeout a frases para el drawer. Sin bodies ni claves en el mensaje al usuario. Abort → string vacío (no mostrar error). |

## Dependencias externas (adapters)

| Puerto | Adapter | Notas |
|--------|---------|--------|
| Identificado | HTTP GET introspect | Contrato: JSON con `userId`, `email?`, `name?` |
| Identidad pública | `anon:<uuid>` del cliente | Sin introspect ni persistencia |
| Tools | MCP HTTP vía runtime.config | Catálogo dinámico, auth por MCP |
| Modelo | OpenRouter / OpenAI | Providers en runtime.config |
| Persistencia | Memory MCP (`MEMORY_MCP_URL`) | Default: `apps/memory-mcp` → Prisma → Postgres `memory` |

[← Diseño](./01-diseno-y-modelo.md) · [Índice](./00-indice.md) · [Flujos →](./03-flujos.md)
