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

La voz no se habilita implícitamente. Aunque `model.realtime` puede estar configurado, la voz queda deshabilitada si `config.realtime` está ausente. Para deshabilitarla, eliminá la propiedad `realtime` de `config`.

Para habilitarla, configurá primero `ai.providers.openai.models.realtime` y `ai.providers.openai.realtime.voices` en Administración → Provider. Luego seleccioná `model.realtime` y agregá `config.realtime` al perfil. `config.systemPrompt` es compartido por chat y Realtime; los límites de chat están aislados en `config.chat`. En Realtime, `maxContextMessages` limita los mensajes anteriores incluidos (default 12) y `maxInstructionsCharacters` limita la longitud total de instrucciones enviadas al modelo (default 24000). `maxMessageCharacters`, `maxToolResultCharacters` y `maxSummaryCharacters` limitan por separado el contenido de mensajes, resultados de herramientas y resumen (defaults 4000, 2000 y 4000). `maxOutputTokens` limita la salida por respuesta (default 4096; el proveedor admite enteros entre 1 y 4096 e incluye llamadas a herramientas). El objeto `vad` ajusta el VAD server-side: threshold (0.5), prefixPaddingMs (300), silenceDurationMs (500), createResponse (true) e interruptResponse (true). Todos son configurables por perfil y reciben defaults si se omiten.

```json
{
  "name": "Predeterminado",
  "model": {
    "chat": "openai/gpt-4.1-mini",
    "realtime": "gpt-realtime"
  },
  "config": {
    "systemPrompt": "Sos un asistente útil y claro.",
    "chat": {
      "contextTokenBudget": 10000,
      "maxContextMessages": 20,
      "maxOutputTokens": 4096,
      "reserveOutputTokens": 4096,
      "contextSafetyTokens": 512,
      "maxToolSteps": 8,
      "llmTraceRequests": false,
      "summariesEnabled": true,
      "summaryTokenBudget": 300
    },
    "realtime": {
      "voice": "alloy",
      "maxContextMessages": 12,
      "maxInstructionsCharacters": 24000,
      "maxMessageCharacters": 4000,
      "maxToolResultCharacters": 2000,
      "maxSummaryCharacters": 4000,
      "maxOutputTokens": 4096,
      "vad": {
        "threshold": 0.5,
        "prefixPaddingMs": 300,
        "silenceDurationMs": 500,
        "createResponse": true,
        "interruptResponse": true
      }
    }
  }
}
```

Runtime valida `model.realtime` y `config.realtime.voice` contra los catálogos de Provider. `model` solo admite `chat` y `realtime`; `config.realtime` admite voz, límites de contexto/salida y ajustes VAD documentados arriba; `vad` controla solo los parámetros de `server_vad`, no el modo de detección ni modelos de audio. Los perfiles existentes se normalizan al leerlos: los ajustes de chat planos pasan a `config.chat`, `chatSystemPrompt` pasa a `systemPrompt` y los límites Realtime omitidos reciben los defaults indicados. La voz de conversación usa WebRTC con OpenAI Realtime: Runtime crea una credencial efímera, aplica las instrucciones e historial reciente del perfil asignado y envía al modelo las tools MCP/delegación autorizadas. Las llamadas de tools vuelven al backend autenticado y no exponen MCP al navegador. No se solicita ni se persiste transcripción; tampoco se almacena el audio de la sesión. El navegador se conecta al endpoint Realtime anunciado por Runtime y recibe audio directamente; las claves permanentes nunca salen del servidor.

La disponibilidad se resuelve para el perfil asignado a cada conversación. Al cambiar de perfil, la opción de voz se actualiza; las conversaciones con perfiles sin `config.realtime` no usan voz aunque el proveedor esté configurado. Quitar del catálogo una opción que utiliza un perfil la deja temporalmente no disponible hasta que el perfil se actualice o se vuelva a habilitar esa opción.

## Migración de hilos existentes

La migración agrega `agent_profile_id` a `public.conversations` sin FK entre el esquema público y `runtime`. Al iniciar Runtime, los hilos sin asignación se fijan al perfil activo más antiguo según `created_at` e `id`. Este backfill es idempotente: cambiar el perfil predeterminado más adelante no reasigna conversaciones existentes. El inicio falla si quedan hilos sin asignar (por ejemplo, si no hay un perfil activo), en vez de dejar datos ambiguos. La columna heredada `sort_order` permanece en la tabla por compatibilidad, pero ya no determina la selección de perfiles.

Si un hilo no tiene perfil asignado o su referencia ya no se puede resolver, Runtime no cambia silenciosamente de agente: rechaza el turno con un error para que la asignación se corrija.

## Administración

La administración de perfiles sigue bajo `/admin/agent-profiles`; el listado seleccionable para chats está en `GET /v1/agent-profiles`. El endpoint de modelos y las credenciales siguen siendo responsabilidad de Runtime.
