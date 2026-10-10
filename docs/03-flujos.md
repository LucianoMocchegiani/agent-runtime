# Flujos

## Inicio

1. La tarea de despliegue aplica las migraciones de Memory antes de iniciar Runtime.
2. La API inicia el store de configuración, crea/lee los perfiles y asigna a los hilos antiguos sin perfil el perfil activo predeterminado.
3. Runtime entrega la configuración de embeddings directamente al módulo Memory y arranca su worker interno.
4. La aplicación escucha en un único puerto HTTP. No se inicia un servicio ni cliente MCP para Memory.

## Crear conversación

1. La UI pide los perfiles activos a `GET /v1/agent-profiles`.
2. Envía `POST /v1/conversations` opcionalmente con `agentProfileId`.
3. Runtime verifica que el perfil exista y no esté archivado. Si se omite el ID, elige el perfil predeterminado.
4. Memory persiste la conversación con su referencia al perfil asignado.

## Enviar mensaje

1. La API autentica la petición y busca la conversación en Memory.
2. Runtime carga el perfil referenciado por `agentProfileId`; un perfil archivado sigue siendo válido para el hilo existente.
3. Runtime captura la configuración del perfil para este turno, recupera contexto y preferencias mediante llamadas directas al módulo Memory.
4. El agente ejecuta herramientas MCP externas y transmite la respuesta.
5. Runtime guarda mensajes, título y resumen mediante Memory; el hilo y la asignación siguen persistentes para próximos turnos.

Un turno es temporal: no existe un proceso reservado por conversación. Cambiar la asignación afecta turnos siguientes y no modifica uno que ya está corriendo.

## Cambiar perfil

`PATCH /v1/conversations/:id` recibe `agentProfileId`. Runtime valida el perfil activo antes de guardar la referencia en la conversación. `null` significa reasignar al perfil predeterminado vigente. Archivar un perfil no reescribe conversaciones que ya lo tienen asignado.

## Health y datos

`GET /health` comprueba el proceso y consulta PostgreSQL directamente a través del cliente de Memory. El Compose mantiene el volumen de PostgreSQL; `migrate` es una tarea efímera previa al inicio, no un servidor persistente.
