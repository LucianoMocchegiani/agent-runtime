# Arquitectura actual

Agent Runtime es una aplicación para ejecutar agentes de IA. Está formada por módulos internos y se despliega como **un único servicio de aplicación** más PostgreSQL.

```text
┌─────────────────────────────────────────────┐
│ Runtime API (un proceso / un puerto HTTP)   │
│  ├─ API, auth, UI y administración          │
│  ├─ perfiles y ejecución temporal de turnos │
│  └─ Memory: conversaciones/contexto/búsqueda│
└────────────────────┬────────────────────────┘
                     │ PostgreSQL
          ┌──────────┴───────────┐
          │ public: Memory       │ runtime: config/perfiles
          └──────────────────────┘
```

## Límites de responsabilidad

- **Runtime** es dueño de autenticación, configuración global, perfiles y ejecución de agentes.
- **Memory** administra conversaciones, mensajes, resúmenes, preferencias y búsqueda. Está integrado en el mismo proceso mediante importaciones y llamadas directas; no es un servidor MCP ni un proceso aparte.
- **PostgreSQL** mantiene la persistencia. `public` contiene datos de Memory y `runtime` contiene settings y perfiles.
- **MCP** conecta el agente con herramientas externas. Runtime no usa MCP ni HTTP para hablar con Memory.

Las responsabilidades separadas en código no requieren separar procesos ni puertos. Memory tiene migraciones y modelo de datos propios, aunque corre bajo la aplicación Runtime.

## Perfiles y conversaciones

Un perfil es configuración reutilizable propiedad de Runtime. Cada conversación guarda `agent_profile_id`, una referencia sin FK entre esquemas. Runtime valida el perfil al asignarlo y lo resuelve cada vez que comienza un turno. Conversaciones existentes se backfillean una sola vez al perfil predeterminado; cambios posteriores del default no reasignan los hilos.

Un turno es una ejecución temporal. No hay procesos reservados por hilo. El cambio de perfil durante un chat se aplica a próximos turnos; el turno que ya comenzó conserva su configuración.

## Concurrencia de turnos

La API mantiene un bloqueo en memoria por combinación de usuario y conversación. Al iniciar un turno, reserva esa clave; mientras siga activa, otro `POST /v1/conversations/:id/messages` para el mismo usuario y conversación recibe HTTP `409`. Las conversaciones distintas pueden ejecutar turnos en paralelo. El bloqueo se libera al terminar o fallar el stream, o cuando se cancela la respuesta.

Este mecanismo coordina únicamente solicitudes atendidas por **el mismo proceso de API**: el estado reside en un `Set` local y no se guarda en PostgreSQL ni en otro coordinador compartido. Con varias réplicas, cada proceso tendría su propio bloqueo y dos solicitudes para el mismo hilo podrían ser aceptadas por réplicas diferentes; por lo tanto, no se garantiza exclusión mutua ni se evita que sus escrituras de mensajes se entremezclen. Reiniciar el proceso también elimina los bloqueos en memoria; los turnos interrumpidos por el reinicio no se recuperan mediante este mecanismo.

El despliegue actual de Compose usa una sola instancia de la API, que es el escenario cubierto por este bloqueo. Antes de escalar a varias réplicas, hay que sustituirlo o complementarlo con coordinación compartida —por ejemplo, un bloqueo/advisory lock de PostgreSQL con alcance por usuario y conversación— y definir el comportamiento ante caídas y expiración de bloqueos.

Este bloqueo solo impide turnos duplicados en una conversación; no distribuye el trabajo entre agentes ni reserva un proceso por conversación.

## Persistencia y despliegue

El módulo Memory usa Prisma y PostgreSQL. Runtime mantiene su acceso al schema `runtime` para configuración y perfiles. Las migraciones se ejecutan como tarea de despliegue antes de iniciar la API. En Compose hay PostgreSQL, una tarea efímera `migrate` y un solo servicio persistente `agent-runtime`.

La integración no elimina ni recrea la base existente: conserva el volumen y aplica migraciones compatibles que agregan la referencia de perfil. El health check consulta PostgreSQL dentro del mismo proceso.
