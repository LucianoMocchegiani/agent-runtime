# Diseño y modelo

## Qué es

`agent-runtime` es el **motor del asistente**: conversaciones, historial, stream del modelo y cliente MCP. Es **infra portable** : el huésped se enchufa con env; este paquete **no** conoce el dominio del huésped.

Otra plataforma = **otra instancia** (otro Compose + env). Misma imagen.

```text
Identificado (JWT)                   agent-runtime                     MCP + OpenRouter
       │  Bearer                    │
       ▼                            ▼
  introspect ──→ Principal    MCP_CONFIG → pool MCP multi-conexión
       │                            │
       ▼                            ▼
  Principal {userId}         Memory MCP + tools del MCP
```

Público (sin JWT):
```text
Bearer anon:<uuid> (lo genera y guarda el cliente)
            → Principal {userId: uuid}
            → mismo flow
```

La API **no tiene database**. Hilos y mensajes los guarda el Memory MCP (default `apps/memory-mcp`, reemplazable).

La UI, el login y las tools viven en el **huésped**. El chat solo pide identidad (`AUTH_INTROSPECT_URL`) y tools (`MCP_CONFIG`).

## Stack

| Pieza | Valor |
|-------|--------|
| HTTP | Hono + `@hono/node-server`, Node 24 |
| Persistencia | Memory MCP. El default (`apps/memory-mcp`) usa Prisma 6 sobre la database **`memory`** |
| LLM | Vercel AI SDK + OpenRouter / OpenAI (`AI_CONFIG`) |
| Tools | `@ai-sdk/mcp` HTTP hacia `MCP_CONFIG` |
| Stream | UI Message Stream (`toUIMessageStreamResponse`) |

Arranque: la API hace `node dist/index.js` (sin migraciones). El Memory MCP default corre `setup-db` (crea la database + `prisma migrate deploy`) y después `node dist/index.js`. En dev: `npm run dev` levanta los dos.

## Principios

1. **Controllers delgados.** Rutas parsean JSON y delegan; reglas de dueño y persistencia en servicios.
2. **Un MCP por instancia.** No se agregan servidores en runtime.
3. **Una instancia, todos los huéspedes.** El aislamiento es el JWT (`sub`).
4. **Historial intacto en DB.** La ventana de tokens recorta el **prompt**, no las filas.
5. **System prompt fuera del recorte de historial.** Va en `streamText({ system })`, no como fila `system`.

## Identidad (no es una cuenta nueva)

| Modo | Token | Cómo se resuelve | Principal |
|------|--------|------------------|-----------|
| Identificado | JWT del huésped | `GET AUTH_INTROSPECT_URL` con el mismo Bearer. Cache ~30 s por hash SHA-256. | `userId`, `email`, `name` del JSON |
| Público | `anon:<uuid>` | El cliente genera el UUID y lo guarda (localStorage). Sin Bearer, el runtime genera uno por request. | `userId: uuid` |

La API no guarda quién habló: el principal solo vive durante el request.

El Bearer del request se reenvía al MCP. Cada MCP valida el Bearer contra su auth URL.

### Introspección (identificado)

`agent-runtime` **no** tiene `JWT_ACCESS_SECRET` y **no** parsea el JWT. Pregunta al huésped: "¿este Bearer es válido y quién es?"

```text
Admin (ya logueado)
  Authorization: Bearer <accessToken>
        │
        ▼
agent-runtime  requirePrincipal
        │
        ├─ cache RAM: SHA-256(token) → Principal, TTL 30 s, máx. 256
        │
        └─ miss: GET AUTH_INTROSPECT_URL
                 Header: Authorization: Bearer <mismo token>
                 Timeout 8 s
                        │
                        ▼
              Huésped  GET /auth/me
              verifica firma y expiry
              200 { userId, email?, name? }
```

`AUTH_MAPPING` mapea los campos del JSON respuesta. Cualquier sistema con `/auth/me` funciona.

**Qué se exige del JSON**: `userId` (si falta → 502). `email` / `name` opcionales.

### Sin Bearer (público)

`Bearer anon:<uuid>` → Principal anónimo con ese `userId`. Sin `Authorization` → UUID nuevo en cada request (el cliente nativo siempre manda `anon:`).

### Códigos

| Respuesta | agent-runtime |
|-----------|----------|
| 401 | Sin Bearer / token inválido / introspect 401 |
| 403 | Perfil no permitido por el MCP |
| red caída, timeout, 5xx, body no JSON | 502 |

**Qué no es.** No es OAuth introspection RFC 7662. No hay tabla de passwords. El **refresh** lo hace `web/` contra el huésped. Logout del Admin tira la sesión: el próximo introspect da 401.

## Modelo de datos (Memory MCP default)

Database `memory`, dueño único `apps/memory-mcp` (schema y migraciones en `apps/memory-mcp/prisma`). Sin FKs al schema del huésped. IDs de tenant/user son **texto** copiado del huésped.

```text
conversations    1──N messages
```

### `conversations`

Un hilo del sidebar (como ChatGPT), no un tweet.

| Campo | Rol |
|-------|-----|
| `user_id` | Dueño. Todo list/get/patch filtra por este |
| `title` | `null` hasta el primer mensaje (recorte del texto, sin LLM) o título al crear. `PATCH` no se pisa después |
| `archived_at` | Archivo lógico. `DELETE` = archivar. Mensajes en archivado → 409 |
| `updated_at` | Orden del listado; se toca al persistir turnos |

Índice: `(user_id, updated_at DESC)`. Listado tope 100.

### `messages`

| Campo | Rol |
|-------|-----|
| `role` | `user` \| `assistant` \| `tool` (no hay filas `system`) |
| `content` | Texto para UI y prompt. En tools: resumen (`search → 3 hits`) |
| `tool_name`, `tool_args`, `tool_result` | JSON crudo para el siguiente turno y debug |
| `created_at` | Orden del hilo |

`ON DELETE CASCADE` desde conversación. Listado tope 500 por hilo.

PII de negocio (nombre, documento, deuda) **puede** quedar en `content` / `tool_result`. Fuente de verdad sigue siendo el huésped.

## Ventana de contexto (prompt)

`CHAT_CONTEXT_TOKENS` (default 10 000). Estimación: `ceil(chars / 4)`.

- Se mapean filas a mensajes del modelo (tools y user van como `user`; assistant como `assistant`).
- Las **dos** tools más recientes se dejan más enteras (tope ~1500 chars); las viejas → una línea (`tool → N hits` o `tool → ok`).
- Se llena de **atrás hacia adelante** hasta el presupuesto; lo que no entra **no se borra** de DB.

`CHAT_MAX_TOOL_STEPS` (default 8) corta round-trips del agente.

## Configuración de instancia

Ver `.env.example`. Lo que cambia entre productos: URLs de introspect y MCP, CORS, prompts, clave OpenRouter. Lo que no: código de hilos/stream.

[Índice](./00-indice.md) · [Módulos →](./02-modulos.md)
