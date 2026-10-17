# agent-runtime

Runtime para ejecutar agentes de IA con perfiles reutilizables, conversaciones persistentes y herramientas MCP. La aplicación de Runtime integra Memory dentro del mismo proceso: hay un solo servicio de aplicación y una base PostgreSQL persistente.

**Versión actual: 0.1.0.** Los cambios de esta versión están resumidos en [`CHANGELOG.md`](./CHANGELOG.md).

Visión del producto: [`docs/vision/00-que-es.md`](./docs/vision/00-que-es.md). Diseño y módulos: [`docs/`](./docs/00-indice.md). Convenciones para contribuir: [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md).

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

```sh
cp .env.example .env
openssl rand -hex 32
```

Copiá el valor generado en `RUNTIME_CONFIG_ENCRYPTION_KEY` dentro de `.env` antes del primer inicio. Es obligatorio y debe conservarse: sin la misma clave no se puede descifrar la configuración persistida. En PowerShell podés usar `Copy-Item .env.example .env` y generar la clave con OpenSSL o una herramienta equivalente.

Al primer inicio, Runtime crea `runtime.config` con valores mínimos. Los proveedores, credenciales, herramientas MCP, embeddings y límites se configuran desde Administración. La configuración inicial de administración usa `admin/admin` mientras `RUNTIME_CONFIG_ADMIN_USERS` esté vacío; cambiá las credenciales bootstrap o configurá una lista de administradores antes de exponer el servicio a una red no confiable. El usuario y password de PostgreSQL del Compose predeterminado también son solo para desarrollo local.

| Variable | Uso |
|---|---|
| `DATABASE_URL` | PostgreSQL compartido por Memory y configuración de Runtime; Compose apunta al servicio `postgres` |
| `RUNTIME_CONFIG_ENCRYPTION_KEY` | Obligatoria para cifrar `runtime.config`; generar con `openssl rand -hex 32` y conservarla |
| `DELEGATION_PAYLOAD_ENCRYPTION_KEY` | Opcional; habilita delegaciones. Clave hex de 32 bytes distinta a la anterior, compartida por todas las réplicas |
| `AUTH_INTROSPECT_URL` | Endpoint `GET` para resolver la identidad del huésped |
| `AUTH_MAPPING` | Mapeo JSON de los campos devueltos por introspección |
| `UI_ENABLED` / `UI_DIR` | Habilitar y localizar la UI nativa |
| `CORS_ORIGIN` / `CORS_APP_DOMAIN` | Orígenes de UIs externas |

No se requieren `MEMORY_MCP_URL`, `MEMORY_MCP_PORT`, ni un token para que Memory consulte Runtime.

## Docker Compose

### Normal: una instancia

```sh
docker compose up -d --build
```

El Compose normal ejecuta PostgreSQL, una tarea efímera de migración y una instancia de Runtime en `http://localhost:3010`. Se conserva el volumen `pgdata`; las migraciones se aplican antes de iniciar la API.

### Escalable: varias instancias

```sh
docker compose -f docker-compose.scalable.yml up -d --build --scale agent-runtime=3
```

Este modo usa el mismo PostgreSQL compartido, levanta las réplicas API sin publicar sus puertos y expone HAProxy en `http://localhost:3010`. El balanceador conserva las conexiones de streaming; podés cambiar `3` por la cantidad de réplicas deseada. Los dos Compose son modos alternativos: ambos usan el mismo nombre de proyecto, volumen y puerto local.

La coordinación de turnos normales usa leases atómicos en PostgreSQL. El lease dura hasta 120 segundos y se renueva cada 30; ante la caída de un proceso, puede haber que esperar a que venza antes de enviar otro turno. El stream interrumpido **no se reanuda ni se reintenta** automáticamente.

- UI: `http://localhost:3010/`
- Health: `GET /health` (API y conectividad PostgreSQL)
- Conversaciones: `GET/POST /v1/conversations`
- Mensajes: `POST /v1/conversations/:id/messages`

### Delegaciones entre conversaciones

Las delegaciones están deshabilitadas por defecto. Para habilitarlas, configurá `DELEGATION_PAYLOAD_ENCRYPTION_KEY` con una clave propia de 32 bytes hexadecimales (`openssl rand -hex 32`) y el mismo valor en todas las réplicas; no reutilices `RUNTIME_CONFIG_ENCRYPTION_KEY`. Con esa clave, el agente dispone de `delegate_to_conversation` y `get_delegation_status`: el primero debe usarse solo si el usuario pidió explícitamente delegar a otro hilo; el segundo permite consultar estado y respuesta terminada. El destinatario debe pertenecer al mismo usuario y tener un perfil activo.

Los trabajos se reclaman en PostgreSQL con `FOR UPDATE SKIP LOCKED`; un lease coordina workers y conversaciones. Se cifran con AES-256-GCM el token de acceso, los tokens MCP y la instrucción; el payload cifrado se vacía al terminar. Las imágenes no se incluyen en una delegación. Al finalizar, el agente destinatario guarda su respuesta en el historial del hilo destino; el trabajo y el SSE notifican el estado, no duplican el contenido de la respuesta.

- Estado: `GET /v1/delegations/:id`
- Eventos recuperables: `GET /v1/delegations/:id/events` (SSE; acepta `Last-Event-ID` y consulta PostgreSQL al reconectar)
- Estados: `queued`, `running`, `completed`, `failed`, `interrupted`
- Si un worker cae, el lease vence y el trabajo queda `interrupted`; no se reintenta automáticamente. Tokens expirados o fallos al ejecutar producen `failed`.

Los identificadores de eventos son cursores monotónicos persistidos en la base. `LISTEN/NOTIFY` no se usa como fuente de verdad; los workers consultan la cola cada segundo. Asegurá que la clave de delegación se mantenga fuera del repositorio y que las copias de seguridad de PostgreSQL tengan controles apropiados. Las imágenes se publican en `ghcr.io/lucianomocchegiani/agent-runtime`. Para instalación con las imágenes publicadas desde una copia del repositorio, prepará `deploy/.env` (por ejemplo, copiando `.env.example`, descomentando `AGENT_RUNTIME_VERSION=0.1.0` para fijar esta versión en lugar de `latest`, agregando la clave requerida y revisando `AUTH_INTROSPECT_URL`) y ejecutá `docker compose -f deploy/docker-compose.yml up -d`. Compose espera el archivo de variables junto al YAML. La instalación de imágenes publicadas todavía no tiene un Compose escalable equivalente.

## Estructura

Monorepo npm workspaces con un lockfile:

```text
apps/
├── api/                 # API HTTP y módulos de dominio, incluida la persistencia
└── ui/                  # React/Vite, servida por API
packages/
└── client/              # SDK HTTP/stream para la UI y huéspedes
```

Memory no es un servidor independiente ni un paquete: la búsqueda semántica y sus contratos están en `apps/api/src/memory-search/`, y las operaciones de persistencia viven junto a conversaciones, mensajes y preferencias. Prisma y sus migraciones están en `apps/api/prisma/`. No hay un puerto ni un transporte MCP interno para Memory; MCP se reserva para herramientas externas.

## Desarrollo

```sh
npm install
docker compose up -d postgres
npm run dev        # aplica migraciones, inicia API y Vite
npm run build
npm run typecheck
```

La API sirve en `:3010` y Vite en `:3001`. La UI permite elegir perfil para nuevos chats y cambiar el perfil asignado a una conversación; el cambio afecta los turnos siguientes, no altera un turno que ya está en curso.
