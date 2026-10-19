# Configuración de Runtime

`runtime.config` guarda configuración global de infraestructura en el schema PostgreSQL `runtime`. Los perfiles reutilizables se guardan en `runtime.agent_profile_configs`. Memory persiste conversaciones y mensajes en `public`; el módulo y Runtime comparten el mismo proceso y la misma base PostgreSQL, con ownership lógico separado.

## Autenticación del huésped

La URL de introspección y el mapeo de identidad (`userId`, `email`, `name`) se almacenan en `runtime.config`, cifrados con el resto de la configuración, y se editan desde Administración → Auth. Las variables de entorno de introspección no se usan. Se admiten URLs HTTP y HTTPS; la conectividad y la elección del transporte son responsabilidad de quien despliega.

Una URL vacía desactiva la introspección y deja todas las rutas `/v1` en modo público/anónimo. Los Bearer opacos se ignoran en ese modo; `anon:<uuid>` mantiene la identidad anónima entre solicitudes. Si se configura una URL que no responde, la API responde 502 en solicitudes con Bearer que requieren introspección, salvo resultados todavía vigentes en la caché (30 segundos). HTTP 401/403 del servicio externo se traduce a 401; timeout (8 segundos), otros errores, JSON inválido o ausencia de `userId` se traducen a 502. El acceso administrativo por allowlist también depende de que la introspección funcione. La pestaña incluye una prueba manual con un token temporal, no persistido. Ver [Identidad y autorización](./04-http.md#identidad-y-autorización).

## Embeddings

La configuración de embeddings se guarda cifrada en `runtime.config`. Runtime la entrega directamente al módulo Memory al cargar o actualizar settings. El worker de indexación corre como tarea de fondo dentro del proceso de la API. No hay endpoint interno, token compartido ni llamada HTTP entre Memory y Runtime.

## Perfiles

El modelo y el comportamiento del agente viven en perfiles de Runtime. Las conversaciones almacenan `agent_profile_id`, una referencia sin FK entre schemas. Runtime valida la referencia al asignar y carga el perfil en cada turno. Los hilos anteriores se asignan una sola vez al perfil activo predeterminado durante el startup, tras aplicar la migración de Memory.

Cambiar el perfil predeterminado no reasigna conversaciones existentes. Los perfiles archivados siguen resolviéndose para los hilos que ya los tienen asignados, aunque dejan de aparecer en selectores nuevos. Ver [Perfiles de agente](./agent-profiles.md).

La voz se configura en dos niveles: el catálogo y endpoint compatibles se declaran dentro de `ai.providers.openai.voice` en Administración → Provider; cada perfil habilita la función de forma explícita con `config.voice`. Si la propiedad está ausente, ese perfil no usa voz. Las APIs de voz llaman el endpoint configurado con la credencial OpenAI del servidor; la clave permanente no se entrega al navegador. Se admiten endpoints HTTP y HTTPS. Ver [Perfiles de agente](./agent-profiles.md#configuración-de-voz-por-perfil).

## Variables requeridas

`DATABASE_URL` y `RUNTIME_CONFIG_ENCRYPTION_KEY` son obligatorias. La clave de cifrado debe conservarse mientras haya settings guardados. Memory usa la misma base de datos sin requerir `MEMORY_MCP_URL`, `MEMORY_MCP_PORT` ni `RUNTIME_CONFIG_INTERNAL_TOKEN`.
