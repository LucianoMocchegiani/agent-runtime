# Diseño y modelo

## Qué es

`agent-runtime` es el **motor del asistente**: conversaciones, historial, stream del modelo y cliente MCP. Es **infra portable** : el huésped se enchufa con env; este paquete **no** conoce el dominio del huésped.

Otra plataforma = **otra instancia** (otro Compose + env). Misma imagen.

```text
Identificado (JWT)                   agent-runtime                     MCP + OpenRouter
       │  Bearer                    │
       ▼                            ▼
  introspect ──→ Principal    runtime.config → pool MCP multi-conexión
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

La API no posee los datos de conversación: hilos y mensajes los guarda Memory MCP (default `apps/memory-mcp`, reemplazable). Para configuración dinámica, agent-runtime usa el esquema PostgreSQL separado `runtime`; Memory MCP conserva sus tablas propias en `public`. Ambos procesos pueden conectarse a la misma base, con pools independientes.

La UI, el login y las tools viven en el **huésped**. El chat pide identidad (`AUTH_INTROSPECT_URL`); los MCPs se administran en `runtime.config` (`mcpConfig`).

## Stack

| Pieza | Valor |
|-------|--------|
| HTTP | Hono + `@hono/node-server`, Node 24 |
| Persistencia | Memory MCP. El default (`apps/memory-mcp`) usa Prisma 6 sobre la database **`memory`** |
| LLM | Vercel AI SDK + OpenRouter / OpenAI, proveedores en `runtime.config` |
| Tools | `@ai-sdk/mcp` HTTP hacia los MCPs de `runtime.config` |
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
user_id (texto)  1──N memory_user_preferences
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

### `memory_user_preferences`

Preferencias persistentes separadas de los mensajes, siempre filtradas por `user_id`. Cada registro contiene la instrucción preferida, su condición de activación, categoría y embedding opcional. La API recupera hasta cinco preferencias pertinentes antes de llamar al modelo; combina búsqueda semántica (cuando hay proveedor de embeddings) con similitud de texto. Sin embeddings, sigue funcionando la búsqueda textual.

El modelo puede guardar una preferencia solo ante una petición explícita de recordarla/aplicarla en el futuro; también puede listar preferencias y eliminarlas permanentemente cuando el usuario lo pida. No existe un estado inactivo: una preferencia que ya no se usa se borra y deja de ocupar espacio o de participar en búsquedas. El mensaje actual prevalece ante conflictos. Las herramientas de preferencias reciben el `userId` del principal autenticado desde la API, no desde argumentos generados por el modelo.

PII de negocio (nombre, documento, deuda) **puede** quedar en `content` / `tool_result`. Fuente de verdad sigue siendo el huésped.

## Ventana de contexto (prompt)

`contextTokenBudget` (default 10 000; estimación `ceil(chars / 4)`) y `maxContextMessages` (default 20), guardados en `runtime.config`, limitan juntos el historial recuperado para iniciar el turno. El tope cuenta mensajes user/assistant; excluye el system prompt, las definiciones de tools y las interacciones de tools que ocurren durante el turno activo (necesarias para continuar esa ejecución).

- Los resultados históricos de tools quedan persistidos para memoria/auditoría, pero no se reenvían como mensajes de historial.
- Se seleccionan turnos recientes completos de atrás hacia adelante, respetando ambos límites; el límite por cantidad puede dejar fuera mensajes aunque aún haya presupuesto de tokens.
- Los turnos omitidos se compactan en un resumen persistente breve; no se borran de la base de datos. Para detalles más profundos se puede usar `memory__searchMemory`.

`maxToolSteps` (default 8) en `runtime.config` corta round-trips del agente.

## Configuración de instancia

La configuración de infraestructura (URLs de introspect, CORS y servicios) va en `.env`; proveedores, MCPs, prompts y límites viven en `runtime.config` y se editan desde Administración.

[Índice](./00-indice.md) · [Módulos →](./02-modulos.md)
