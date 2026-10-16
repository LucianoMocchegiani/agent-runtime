# Módulos

Agent Runtime se despliega como una sola aplicación. Las responsabilidades siguen separadas en módulos de código; Memory no es otro servidor y se ejecuta dentro de la API.

```text
apps/api/
├── prisma/                 schema y migraciones de PostgreSQL
└── src/
    ├── conversations/      rutas, servicios y persistencia de conversaciones
    ├── messages/           entrada HTTP y persistencia de mensajes
    ├── preferences/        rutas, cursores y persistencia de preferencias
    ├── memory-search/      búsqueda semántica e indexación
    ├── db/                 cliente Prisma y preparación de la base
    ├── agent/              ejecución temporal de turnos
    ├── runtime-config/     configuración, perfiles y settings
    └── ...                 otros módulos de la API
```

La persistencia se ubica con el dominio correspondiente. La búsqueda semántica y sus contratos viven en `apps/api/src/memory-search/`; el schema y las migraciones están en `apps/api/prisma/`.

## API y ejecución

`apps/api/src/app.ts` monta CORS, health, rutas administrativas, API autenticada y UI. `GET /health` verifica acceso a PostgreSQL.

`conversations/` valida requests y delega en la persistencia de conversaciones. `messages/` valida el mensaje, obtiene la conversación y resuelve el perfil asignado en Runtime. `agent/run.ts` ejecuta el turno, usa las operaciones de persistencia y búsqueda para contexto y memoria, e integra herramientas MCP externas.

Los perfiles son propiedad de Runtime (`runtime.agent_profile_configs`). La conversación mantiene solo `agent_profile_id`; Runtime comprueba la referencia y aplica la configuración al ejecutar cada turno.

## Memory dentro de la API

`conversations/persistence.ts`, `messages/persistence.ts` y `preferences/persistence.ts` agrupan las operaciones de datos con sus dominios. `memory-search/` implementa la búsqueda semántica y el worker de indexación.

Las embeddings se configuran en `runtime.config`; Runtime inyecta el valor directamente al módulo de búsqueda y arranca el worker dentro del proceso de la API. PostgreSQL puede tener esquemas distintos (`public` para los datos de la aplicación y `runtime` para configuración), en la misma base de datos.

## Despliegue

Compose contiene PostgreSQL, un contenedor efímero de migración y el servicio único `agent-runtime`. La tarea de migración ejecuta Prisma desde el workspace `apps/api` y termina antes de iniciar la API. Las migraciones existentes se conservan; no se recrea el volumen de datos.
