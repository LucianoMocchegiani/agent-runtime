# Diseño y modelo

## Arquitectura

```text
UI / huésped
    │ HTTP + stream
    ▼
Runtime API (único proceso de aplicación)
    ├── autenticación y rutas
    ├── perfiles + ejecución de turnos
    └── módulo interno Memory ───┐
                                ▼
                         PostgreSQL persistente
                         ├── public: conversaciones, mensajes, recuerdos
                         └── runtime: settings y perfiles
```

Memory es parte del mismo sistema y proceso que Runtime. Conserva límites de dominio, Prisma, schema y migraciones, pero no tiene puerto, endpoint MCP interno ni servidor separado. El PostgreSQL continúa siendo un servicio independiente y conserva el volumen persistente.

## Modelo conceptual

- **Perfil**: configuración reutilizable del agente, propiedad de Runtime.
- **Conversación/hilo**: registro persistente de mensajes y recuerdos, propiedad del módulo Memory.
- **Perfil asignado**: referencia `agent_profile_id` que Memory guarda en la conversación; Runtime valida y resuelve el ID.
- **Turno**: ejecución temporal iniciada al enviar un mensaje. El hilo no reserva un proceso.

```text
Perfil ──asignado a──> Conversación ──contiene──> Mensajes
                             │
                             └── cada mensaje nuevo inicia un turno temporal
```

La referencia al perfil no tiene FK entre esquemas: Runtime es propietario de los perfiles y Memory persiste datos de conversación. Los hilos existentes se asignan de forma idempotente al perfil predeterminado en la primera inicialización con la migración nueva.

## Persistencia y despliegue

`public` contiene conversaciones, mensajes y estructuras de Memory. `runtime` contiene settings cifrados, historial de settings y perfiles. Aunque son esquemas separados, la API y Memory se ejecutan dentro del mismo proceso y utilizan PostgreSQL.

En Docker Compose hay PostgreSQL, una tarea efímera que aplica migraciones y un único servicio de aplicación. Las migraciones corren antes de la API; no se recrea el volumen al integrar Memory. En desarrollo `npm run dev` aplica migraciones y levanta la API junto con Vite.

## Perfiles por conversación

Al crear una conversación se puede seleccionar un perfil activo; si se omite, se asigna el predeterminado. El perfil puede cambiarse explícitamente por API o UI. Runtime resuelve la asignación en cada turno y conserva una instantánea de configuración durante la ejecución en curso. Archivar un perfil evita nuevas asignaciones pero no rompe conversaciones que ya lo usan.

## Configuración

La configuración global de infraestructura y secretos reside en `runtime.config`; perfiles guardan modelo y configuración de comportamiento. `DATABASE_URL` y `RUNTIME_CONFIG_ENCRYPTION_KEY` son requeridas. No existen variables `MEMORY_MCP_URL`, `MEMORY_MCP_PORT` o token para comunicaciones Memory–Runtime.
