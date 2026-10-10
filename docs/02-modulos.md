# Módulos

Agent Runtime se despliega como una sola aplicación. Las responsabilidades siguen separadas en módulos de código; Memory no es otro servidor y Runtime la invoca directamente.

```text
apps/api/                 proceso HTTP único
├── conversations/         rutas y servicios HTTP de conversaciones
├── messages/              entrada de mensajes
├── agent/                 ejecución temporal de turnos
├── runtime-config/        configuración, perfiles y settings
└── memory/                adaptador interno hacia el módulo Memory

packages/memory/           módulo de dominio Memory consumido por la API
├── src/module.ts           punto de entrada del paquete interno
└── Prisma                   configuración del schema/migraciones del módulo

La implementación, Prisma y las migraciones de Memory viven dentro de `packages/memory`.
```

## API y ejecución

`apps/api/src/app.ts` monta CORS, health, rutas administrativas, API autenticada y UI. `GET /health` verifica acceso a la base de datos usada por Memory.

`conversations/` valida requests y delega en Memory. `messages/` valida el mensaje, obtiene la conversación y resuelve el perfil asignado en Runtime. `agent/run.ts` ejecuta el turno, usa Memory para contexto y persistencia, e integra herramientas MCP externas.

Los perfiles son propiedad de Runtime (`runtime.agent_profile_configs`). La conversación mantiene solo `agent_profile_id` en sus datos de Memory; Runtime comprueba la referencia y aplica la configuración al ejecutar cada turno.

## Memory interno

El adaptador `apps/api/src/memory/client.ts` ya no crea un cliente MCP ni realiza llamadas HTTP: devuelve operaciones directas del módulo `agent-runtime-memory`. Prisma y sus migraciones permanecen como responsabilidad del dominio Memory. PostgreSQL puede tener esquemas distintos (`public` para las tablas Memory y `runtime` para la configuración), pero comparte servidor/base y una única conexión lógica del producto.

Las embeddings se configuran en `runtime.config`; Runtime inyecta el valor directamente al módulo Memory y arranca el worker de indexación dentro del proceso de la API. No existe `/internal/runtime-config/embedding` ni se requiere `MEMORY_MCP_URL` o `RUNTIME_CONFIG_INTERNAL_TOKEN`.

## Despliegue

Compose contiene PostgreSQL, un contenedor efímero de migración y el servicio único `agent-runtime`. La tarea de migración termina antes de iniciar la API. La migración conserva las tablas existentes y agrega la asociación perfil-conversación; no se recrea el volumen de datos.
