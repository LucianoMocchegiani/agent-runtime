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

## Configuración de voz por perfil

La voz no se habilita implícitamente. Si `config.voice` está ausente, no aparece como disponible para las conversaciones del perfil y no se aplica ningún modelo, voz o idioma predeterminado. Para deshabilitarla, eliminá la propiedad `voice` del JSON del perfil.

Para habilitarla, configurá primero el catálogo de voz de OpenAI en Administración → Provider y agregá `voice` a la configuración completa del perfil. El JSON de ejemplo muestra el objeto `config` completo: al editar un perfil, conservá todos los campos requeridos y agregá o quitá solo la propiedad opcional `voice` según corresponda.

```json
{
  "chatSystemPrompt": "Sos un asistente útil y claro.",
  "contextTokenBudget": 10000,
  "maxContextMessages": 20,
  "maxOutputTokens": 4096,
  "reserveOutputTokens": 4096,
  "contextSafetyTokens": 512,
  "maxToolSteps": 8,
  "llmTraceRequests": false,
  "summariesEnabled": true,
  "summaryTokenBudget": 300,
  "voice": {
    "transcriptionModel": "gpt-4o-mini-transcribe",
    "speechModel": "tts-1",
    "speechVoice": "alloy",
    "language": "es"
  }
}
```

Runtime valida que los modelos de transcripción y síntesis y la voz elegidos estén habilitados en Provider. La configuración del proveedor contiene `baseUrl`, `transcriptionModels`, `speechModels` y `speechVoices`; actualmente la integración usa la clave del proveedor OpenAI y sus APIs Realtime y `audio/speech`. La URL puede ser HTTP o HTTPS y debe ser accesible desde el servicio Runtime. El formato PCM, la frecuencia, la detección de silencio y el formato de audio se mantienen como parámetros técnicos del transporte.

La disponibilidad se resuelve para el perfil asignado a cada conversación. Al cambiar de perfil, la opción de voz se actualiza; las conversaciones con perfiles sin `config.voice` no usan voz aunque el proveedor esté configurado. Quitar del catálogo una opción que utiliza un perfil la deja temporalmente no disponible hasta que el perfil se actualice o se vuelva a habilitar esa opción.

## Migración de hilos existentes

La migración agrega `agent_profile_id` a `public.conversations` sin FK entre el esquema público y `runtime`. Al iniciar Runtime, los hilos sin asignación se fijan al perfil activo más antiguo según `created_at` e `id`. Este backfill es idempotente: cambiar el perfil predeterminado más adelante no reasigna conversaciones existentes. El inicio falla si quedan hilos sin asignar (por ejemplo, si no hay un perfil activo), en vez de dejar datos ambiguos. La columna heredada `sort_order` permanece en la tabla por compatibilidad, pero ya no determina la selección de perfiles.

Si un hilo no tiene perfil asignado o su referencia ya no se puede resolver, Runtime no cambia silenciosamente de agente: rechaza el turno con un error para que la asignación se corrija.

## Administración

La administración de perfiles sigue bajo `/admin/agent-profiles`; el listado seleccionable para chats está en `GET /v1/agent-profiles`. El endpoint de modelos y las credenciales siguen siendo responsabilidad de Runtime.
