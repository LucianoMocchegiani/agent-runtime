# agent-runtime

Motor del asistente: hilos, stream y cliente MCP. **Portable**: cualquier app se conecta; este paquete **no** conoce su dominio.

Visión del producto: [`docs/vision/`](./docs/vision/00-que-es.md). Cómo está modelado y qué hace cada módulo: [`docs/`](./docs/00-indice.md).

Otra plataforma = **otra instancia** (Compose + env). Misma imagen. Cero strings `GYMBRO_*`.

## Cómo se enchufa (analogía Redis)

| Pieza | Quién la pone | Qué es |
|-------|----------------|--------|
| `agent-runtime` | Infra | Sin database. Stream con OpenRouter/OpenAI, llama a los MCP con el Bearer del request |
| Memory MCP | Infra (default `apps/memory-mcp`) o reemplazo | Hilos y mensajes en la DB `memory`. Reemplazable por cualquier MCP que cumpla `agent-runtime-memory-contract` |
| MCP | El producto huésped | Tools → su API |
| UI | Nativa (`ui/`, servida en `/`) o el huésped con el SDK (`client/`) | Chat |
| Auth | El huésped | `GET AUTH_INTROSPECT_URL` con el mismo JWT |

El Admin ya tiene sesión. El drawer manda `Authorization: Bearer`. Logout del Admin corta el chat.

## Env

```powershell
cd agent-runtime
Copy-Item .env.example .env
```

| Variable | Notas |
|----------|--------|
| `DATABASE_URL` | Solo memory-mcp. Postgres database **`memory`**, user `agent`. En dev `localhost:5433`; Compose la pisa |
| `MEMORY_MCP_PORT` / `MEMORY_MCP_HOST` | Solo memory-mcp. Default `3012` / `127.0.0.1` (no tiene auth propia: no exponerlo a la red) |
| `MCP_CONFIG` | MCPs (JSON `{"nombre":{"url","auth","headers","optional"}}`). Tools al modelo como `nombre__tool`. `headers` = secretos del servidor; `optional` = si no conecta, el turno sigue sin sus tools |
| `MEMORY_MCP_URL` | URL del Memory MCP que usa la API |
| `AUTH_INTROSPECT_URL` | `GET` identidad |
| `AUTH_MAPPING` | Mapeo de campos del introspect (JSON) |
| `AI_CONFIG` | Modelos de IA (JSON `{"default","providers":{"openrouter"\|"openai":{"apiKey","models"}}}`). Ids `proveedor/modelo` estilo opencode; el cliente elige por mensaje (`GET /v1/models`). Proveedor con `replace-me` queda deshabilitado. Tras editar `.env`, recreá el contenedor |
| `UI_ENABLED` | UI nativa en `/` (default `true`). `false` = solo API |
| `UI_DIR` | Carpeta del build de la UI. Default `apps/ui/dist` |
| `CORS_ORIGIN` / `CORS_APP_DOMAIN` | Orígenes de UIs externas (huéspedes con el SDK). La UI nativa no lo necesita |
| `SYSTEM_PROMPT` | Texto de instancia |
| `CHAT_CONTEXT_TOKENS` | Ventana del prompt (default 10000) |
| `CHAT_CONTEXT_MESSAGES` | Máximo de mensajes conversacionales históricos al iniciar el turno (default 20; no cuenta system/tools ni pasos de tools en curso) |
| `CHAT_MAX_TOOL_STEPS` | Tope de round-trips con tools (default 8) |

## Usar sin clonar

Las imágenes se publican en GitHub Container Registry en cada push a `main` (`:latest`) y en cada tag `vX.Y.Z` (`:X.Y.Z`):

- `ghcr.io/lucianomocchegiani/agent-runtime` (API + UI)
- `ghcr.io/lucianomocchegiani/agent-runtime-memory-mcp`

Solo hacen falta dos archivos:

```powershell
mkdir agent-runtime; cd agent-runtime
curl.exe -o docker-compose.yml https://raw.githubusercontent.com/LucianoMocchegiani/agent-runtime/main/deploy/docker-compose.yml
curl.exe -o .env https://raw.githubusercontent.com/LucianoMocchegiani/agent-runtime/main/.env.example
# completar .env (AI_CONFIG y, para config dinámica, DATABASE_URL + claves runtime)
docker compose up -d           # http://localhost:3010
```

Actualizar: `docker compose pull; docker compose up -d`. Versión fija: `AGENT_RUNTIME_VERSION=0.1.0` en `.env`.

Publicar una versión: `git tag v0.1.0; git push origin v0.1.0` (workflow `.github/workflows/images.yml`).

## Compose (desde el código)

```powershell
cd agent-runtime
docker compose up --build -d   # Postgres + Memory MCP + API con UI
```

Puertos publicados solo en `127.0.0.1` (la UI no pide login). Un Dockerfile, dos imágenes: `--target api` (API + UI) y `--target memory-mcp` (crea la database, migra y arranca). El Memory MCP queda en la red interna; para usarlo desde el host, descomentá su `ports` en el compose.

- UI: `http://localhost:3010/`
- Health: `GET http://localhost:3010/health` (proceso + handshake con el Memory MCP)
- Sin JWT → session anónima (`anon:<uuid>` que guarda el cliente; la API no persiste conversaciones)
- Con JWT → introspección → identificado
- Hilos: `GET/POST /v1/conversations` (JWT identificado)
- Mensajes: `POST /v1/conversations/:id/messages` → UI Message Stream; **Parar** aborta y persiste lo generado
- Título: primer mensaje recortado; `PATCH` para editar

## Estructura

Monorepo con npm workspaces: un solo `npm install` y un solo `package-lock.json` en la raíz.

| Carpeta | Paquete | Qué es |
|---------|---------|--------|
| `apps/api` | `agent-runtime-api` | La API (Hono). Sin database |
| `apps/memory-mcp` | `agent-runtime-memory-mcp` | Memory MCP default (Hono + MCP SDK + Prisma), dueño de la DB `memory` |
| `apps/ui` | `agent-runtime-ui` | UI nativa (React + Vite), servida por la API en `/` |
| `packages/client` | `agent-runtime-client` | SDK para la UI nativa y para huéspedes que embeben el chat |
| `packages/memory-contract` | `agent-runtime-memory-contract` | Tools y DTOs del Memory MCP: lo implementa memory-mcp y lo consume la API |

`apps/` = lo que se ejecuta; `packages/` = librerías que consumen otros.

## Desarrollo

```powershell
cd agent-runtime
npm install
docker compose up -d postgres   # solo Postgres, en localhost:5433
npm run dev        # migra la DB y levanta memory-mcp (:3012) + API (:3010) + Vite (http://localhost:3001)
npm run build      # packages → ui → api → memory-mcp
npm run typecheck
```

Los scripts de dev leen `agent-runtime/.env` (`--env-file`). Comandos de un paquete: `npm run <script> -w apps/api` (o `apps/memory-mcp`, `apps/ui`, `packages/client`).

Vite proxea `/v1` y `/health` al runtime, así que en dev tampoco hace falta CORS. Otra URL de runtime: `AGENT_RUNTIME_URL`.

## Qué no hace

No cobra, no enrola débito. Las tools y los `links` de chips los trae el MCP. Tope de uso por identificado = pendiente.
pe de uso por identificado = pendiente.
ado = pendiente.
