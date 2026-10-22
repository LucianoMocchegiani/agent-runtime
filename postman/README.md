# Postman

1. Importá `agent-runtime.postman_collection.json` y `agent-runtime.local.postman_environment.json`.
2. Seleccioná **Agent Runtime - Local** y ajustá `baseUrl` si el API no corre en `http://localhost:3030`.
3. En modo público, `userToken` ya contiene una identidad anónima persistente (`anon:<uuid>`). Si Runtime usa introspección, reemplazalo por un Bearer válido.
4. Para rutas `/admin`, configurá `adminToken` con el valor de `RUNTIME_CONFIG_ADMIN_TOKEN` (o el mecanismo admin habilitado en el servidor).
5. Antes de usar los requests de perfil/chat, reemplazá `modelId` por un modelo habilitado. Los identificadores `conversationId`, `messageId`, `profileId`, etc. son ejemplos: pegá los IDs devueltos por las respuestas.

La colección incluye los endpoints de administración y `/v1`. Las rutas de voz y delegaciones solo responden si están habilitadas. Para `/admin/runtime-config`, el PUT es ilustrativo y reemplaza toda la configuración: hacé GET primero y conservá los secretos/settings correctos antes de guardar.
