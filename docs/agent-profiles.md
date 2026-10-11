# Perfiles de agente

Un perfil es una configuración reutilizable propiedad de Runtime: modelo, prompt y límites del agente. Una conversación es el historial persistente que administra el módulo interno Memory. La conversación guarda `agentProfileId`; no guarda una copia de toda la configuración.

```text
Perfil (Runtime) ─────┐
                      ├── Conversación (Memory) ─── mensajes
Turno temporal ───────┘       usa el perfil asignado
```

La asociación es una referencia sin FK entre esquemas. Runtime valida el perfil al asignarlo y lo resuelve al comienzo de cada turno. No se reserva un proceso por hilo.

## Asignación y cambios

- Al crear una conversación, se puede elegir un perfil activo. Si no se envía uno, se asigna el perfil predeterminado para nuevos chats.
- La UI ofrece un selector para nuevos chats y muestra un selector en cada conversación. Cambiar el predeterminado solo afecta a los chats que se creen después; no modifica conversaciones existentes.
- `PATCH /v1/conversations/:id` acepta `agentProfileId` para cambiar la asignación. Enviar `null` restablece el perfil predeterminado vigente.
- Los perfiles archivados no se ofrecen para nuevas asignaciones, pero se conservan para las conversaciones que ya los usan. Runtime puede resolverlos para esos hilos.
- Un cambio en la configuración del perfil se aplica a los próximos turnos. Un turno en curso conserva la instantánea con la que comenzó.

## Migración de hilos existentes

La migración agrega `agent_profile_id` a `public.conversations` sin FK entre el esquema público y `runtime`. Al iniciar Runtime, los hilos sin asignación se fijan al perfil activo más antiguo según `created_at` e `id`. Este backfill es idempotente: cambiar el perfil predeterminado más adelante no reasigna conversaciones existentes. El inicio falla si quedan hilos sin asignar (por ejemplo, si no hay un perfil activo), en vez de dejar datos ambiguos. La columna heredada `sort_order` permanece en la tabla por compatibilidad, pero ya no determina la selección de perfiles.

Si un hilo no tiene perfil asignado o su referencia ya no se puede resolver, Runtime no cambia silenciosamente de agente: rechaza el turno con un error para que la asignación se corrija.

## Administración

La administración de perfiles sigue bajo `/admin/agent-profiles`; el listado seleccionable para chats está en `GET /v1/agent-profiles`. El endpoint de modelos y las credenciales siguen siendo responsabilidad de Runtime.
