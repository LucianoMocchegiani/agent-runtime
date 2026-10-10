# Configuración de Runtime

`runtime.config` guarda configuración global de infraestructura en el schema PostgreSQL `runtime`. Los perfiles reutilizables se guardan en `runtime.agent_profile_configs`. Memory persiste conversaciones y mensajes en `public`; el módulo y Runtime comparten el mismo proceso y la misma base PostgreSQL, con ownership lógico separado.

## Embeddings

La configuración de embeddings se guarda cifrada en `runtime.config`. Runtime la entrega directamente al módulo Memory al cargar o actualizar settings. El worker de indexación corre como tarea de fondo dentro del proceso de la API. No hay endpoint interno, token compartido ni llamada HTTP entre Memory y Runtime.

## Perfiles

El modelo y el comportamiento del agente viven en perfiles de Runtime. Las conversaciones almacenan `agent_profile_id`, una referencia sin FK entre schemas. Runtime valida la referencia al asignar y carga el perfil en cada turno. Los hilos anteriores se asignan una sola vez al perfil activo predeterminado durante el startup, tras aplicar la migración de Memory.

Cambiar el perfil predeterminado no reasigna conversaciones existentes. Los perfiles archivados siguen resolviéndose para los hilos que ya los tienen asignados, aunque dejan de aparecer en selectores nuevos. Ver [Perfiles de agente](./agent-profiles.md).

## Variables requeridas

`DATABASE_URL` y `RUNTIME_CONFIG_ENCRYPTION_KEY` son obligatorias. La clave de cifrado debe conservarse mientras haya settings guardados. Memory usa la misma base de datos sin requerir `MEMORY_MCP_URL`, `MEMORY_MCP_PORT` ni `RUNTIME_CONFIG_INTERNAL_TOKEN`.
