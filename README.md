# agent-runtime

Runtime para ejecutar agentes de IA con perfiles reutilizables, conversaciones persistentes y herramientas MCP. La aplicación de Runtime integra Memory dentro del mismo proceso: hay un solo servicio de aplicación y una base PostgreSQL persistente.

Visión del producto: [`docs/vision/00-que-es.md`](./docs/vision/00-que-es.md). Diseño y módulos: [`docs/`](./docs/00-indice.md).

## Componentes

| Pieza | Responsabilidad |
|---|---|
| Runtime API | Autenticación, perfiles, ejecución de turnos, herramientas MCP externas y UI nativa |
| Memory (módulo interno) | Conversaciones, mensajes, resúmenes, preferencias y búsqueda; acceso directo a PostgreSQL desde Runtime |
| Perfiles | Configuraciones reutilizables de agente, propiedad de Runtime |
| Conversación | Historial persistente que guarda el ID del perfil asignado |
| Turno | Ejecución temporal al enviar un mensaje; no reserva un proceso por conversación |
| UI / SDK | UI incluida o cliente para aplicaciones huésped |

Memory conserva su límite de dominio, tipos, Prisma y migraciones, pero **no es un servidor separado**: no tiene puerto, URL ni transporte MCP interno. MCP se usa para herramientas externas.

## Configuración

```powershell
Copy-Item .env.example .env
```

Al primer inicio, Runtime crea `runtime.config` con valores mínimos. Los proveedores, credenciales, herramientas MCP, embeddings y límites se configuran desde Administración.

| Variable | Uso |
|---|---|
| `DATABASE_URL` | PostgreSQL compartido por Memory y configuración de Runtime; Compose apunta al servicio `postgres` |
| `RUNTIME_CONFIG_ENCRYPTION_KEY` | Obligatoria para cifrar `runtime.config`; generar con `openssl rand -hex 32` y conservarla |
| `AUTH_INTROSPECT_URL` | Endpoint `GET` para resolver la identidad del huésped |
| `AUTH_MAPPING` | Mapeo JSON de los campos devueltos por introspección |
| `UI_ENABLED` / `UI_DIR` | Habilitar y localizar la UI nativa |
| `CORS_ORIGIN` / `CORS_APP_DOMAIN` | Orígenes de UIs externas |

No se requieren `MEMORY_MCP_URL`, `MEMORY_MCP_PORT`, ni un token para que Memory consulte Runtime.

## Docker Compose

```sh
docker compose up -d --build
```

El Compose ejecuta PostgreSQL, una tarea efímera de migración y **un solo servicio de aplicación** en `http://localhost:3010`. Se conserva el volumen de PostgreSQL existente; las migraciones se aplican antes de iniciar Runtime.

- UI: `http://localhost:3010/`
- Health: `GET /health` (API y conectividad PostgreSQL)
- Conversaciones: `GET/POST /v1/conversations`
- Mensajes: `POST /v1/conversations/:id/messages`

Las imágenes se publican en `ghcr.io/lucianomocchegiani/agent-runtime`. Para instalación sin clonar, usá `deploy/docker-compose.yml`.

## Estructura

Monorepo npm workspaces con un lockfile:

```text
apps/
├── api/                 # único proceso de aplicación; coordina los módulos
└── ui/                  # React/Vite, servida por API
packages/
├── client/              # SDK HTTP/stream para la UI y huéspedes
├── memory/              # workspace y entrada pública del módulo Memory
└── memory-contract/     # tipos y DTOs internos de Memory
```

`packages/memory` es un workspace de código, no un servidor. Runtime llama al módulo directamente en el mismo proceso; no hay un servicio, puerto ni transporte MCP interno para Memory. MCP se reserva para herramientas externas.

La implementación, el schema y las migraciones de Memory viven en `packages/memory`; `apps/memory-mcp` ya no es un workspace ni un servicio desplegable.

## Desarrollo

```sh
npm install
docker compose up -d postgres
npm run dev        # aplica migraciones, inicia API y Vite
npm run build
npm run typecheck
```

La API sirve en `:3010` y Vite en `:3001`. La UI permite elegir perfil para nuevos chats y cambiar el perfil asignado a una conversación; el cambio afecta los turnos siguientes, no altera un turno que ya está en curso.
