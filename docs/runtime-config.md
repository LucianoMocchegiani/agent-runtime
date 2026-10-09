# Configuración dinámica de agent-runtime

La configuración operativa vive exclusivamente en `runtime.config`, en un esquema PostgreSQL propio del runtime. Puede compartir servidor y base con Memory MCP, pero no comparte sus tablas ni su ownership: Memory MCP conserva sus datos en `public`. Cada proceso mantiene su propio pool de conexiones.

## Alcance

Se guardan y recargan sin reiniciar:

- Providers/modelos y modelo por defecto (`ai`).
- MCPs (`mcpConfig`).
- Configuración de embeddings (`embeddingConfig`), con API key cifrada.
- Prompt y límites del chat, resúmenes y trazas.

Los embeddings usan el esquema vectorial de Memory MCP (`vector(1536)`). Solo se admiten modelos que devuelvan 1536 dimensiones. Si cambia el modelo o endpoint, Memory MCP vuelve a encolar los documentos para indexarlos con la configuración nueva. Cambiar la dimensión requiere una migración y reindexación separadas.

## Primer inicio y seed mínimo

La configuración funcional no se carga desde env. Cuando no existe la fila `active`, la API crea automáticamente el esquema/tablas de `runtime.config`, guarda la fila activa y registra su primera versión en `runtime.config_history`.

El seed predeterminado es:

- Sin proveedores de IA (`ai.providers: {}` y `ai.defaultModel: ""`). El chat devuelve `503` hasta agregar un provider y modelo desde Administración → Providers.
- Sin MCPs (`mcpConfig: {}`).
- Sin embeddings (`embeddingConfig: null`); Memory MCP usa búsqueda textual.
- Prompt general en español.
- Contexto: 10.000 tokens, hasta 20 mensajes, seguridad de 512 tokens.
- Salida máxima y reserva de salida: 4.096 tokens cada una.
- Máximo 8 pasos de tools; resúmenes habilitados con presupuesto de 300 tokens; trazas LLM deshabilitadas.

El seed no contiene credenciales ni endpoints funcionales. `runtime.config` existente siempre prevalece y no se reemplaza en reinicios. Si falta la fila activa, se crea de nuevo con esos defaults vacíos, no se reconstruyen credenciales borradas.

## Requisitos de infraestructura

Configurar en `.env`:

```dotenv
DATABASE_URL=postgresql://agent:agent@localhost:5433/memory?schema=public
RUNTIME_CONFIG_ENCRYPTION_KEY=<64 caracteres hex generados con openssl rand -hex 32>
RUNTIME_CONFIG_INTERNAL_TOKEN=<secreto aleatorio largo>
```

`DATABASE_URL` y `RUNTIME_CONFIG_ENCRYPTION_KEY` son obligatorias: sin ellas la API no arranca. Guardar una copia segura de la clave y no cambiarla mientras haya configuración cifrada. No hay modo alternativo de carga desde env.

`RUNTIME_CONFIG_INTERNAL_TOKEN` se comparte entre API y Memory MCP y autoriza a Memory a consultar la configuración de embeddings. Es necesario para habilitar embeddings; si falta, Memory sigue en modo de búsqueda textual aunque se guarde `embeddingConfig`.

En Compose, el servicio API sustituye el host de `DATABASE_URL` por `postgres`. La API consulta versiones cada 3 segundos y aplica cambios publicados por la UI/API sin reiniciar. Los secretos se cifran con AES-256-GCM antes de escribirlos en PostgreSQL.

## Administración desde la UI y API

La UI nativa incluye Administración → Configuración del runtime, con secciones JSON para Chat, Providers, Embeddings y MCP. Cada pestaña muestra una guía y ejemplos. Lee y guarda configuración versionada, enmascara secretos y envía la versión observada para detectar conflictos. En una instalación sin providers, abre la pestaña Providers y explica que hay que añadir uno para habilitar el chat.

En Chat, `maxOutputTokens` es el máximo por llamada y `reserveOutputTokens` es el espacio descontado al seleccionar historial; ambos deben ser enteros positivos y `reserveOutputTokens >= maxOutputTokens`. Cambiar modelo/endpoint de embeddings inicia la reindexación de documentos pendientes; sigue aplicando la limitación vectorial 1536.

Mientras `RUNTIME_CONFIG_ADMIN_USERS` esté vacío, la UI permite el acceso clásico con usuario y contraseña `admin` / `admin` (salvo que se sobrescriban con `RUNTIME_CONFIG_BOOTSTRAP_USER` y `RUNTIME_CONFIG_BOOTSTRAP_PASSWORD`). **Cambiar la contraseña y asegurar el acceso antes de exponer el servicio.**

Al configurar el primer `userId` y/o email en `RUNTIME_CONFIG_ADMIN_USERS`, el acceso clásico se desactiva automáticamente. La UI solicita el access token normal del usuario; el backend lo valida con `AUTH_INTROSPECT_URL` y compara su identidad con la allowlist. `AUTH_MAPPING` debe mapear los campos de userId/email correspondientes. Los tokens anónimos de chat no tienen acceso. El token de administración del runtime nunca es necesario en el navegador. Para cambiar entre modo bootstrap y modo allowlist, reiniciar la API después de editar el env.

`GET` y `PUT /admin/runtime-config` también aceptan `Authorization: Bearer <RUNTIME_CONFIG_ADMIN_TOKEN>` para operaciones automatizadas/CLI. Este secreto da control total y debe mantenerse solo en el servidor o en herramientas de confianza. Servir la UI y el endpoint solo por HTTPS en entornos compartidos.

- `GET /admin/runtime-config`: devuelve la configuración activa y su `version`; enmascara API keys, headers MCP y auth como `********`.
- `PUT /admin/runtime-config`: valida y persiste una nueva versión. Los campos enmascarados conservan el secreto actual. Si la versión enviada quedó desactualizada, devuelve `409`.

El body de PUT tiene esta forma: `{ "version": 3, "settings": { "ai": ..., "mcpConfig": ..., "embeddingConfig": null, "chatSystemPrompt": ..., "contextTokenBudget": ..., "maxContextMessages": ..., "maxOutputTokens": ..., "reserveOutputTokens": ..., "contextSafetyTokens": ..., "maxToolSteps": ..., "llmTraceRequests": ..., "summariesEnabled": ..., "summaryTokenBudget": ... } }`. `ai` puede tener `providers: {}` y `defaultModel: ""` hasta que se configure el primer proveedor. Enviar `embeddingConfig: null` deshabilita embeddings. Incluir la versión de GET evita sobrescribir actualizaciones concurrentes.

Ejemplo de inspección:

```sh
curl -H "Authorization: Bearer $RUNTIME_CONFIG_ADMIN_TOKEN" \
  http://localhost:3010/admin/runtime-config
```

El trace de requests puede incluir contenido privado; habilitarlo solo de forma temporal.

Memory MCP consulta internamente `GET /internal/runtime-config/embedding` con `RUNTIME_CONFIG_INTERNAL_TOKEN`. Ese token no es el de administración; compartirlo solo entre API y Memory MCP. El endpoint devuelve únicamente la configuración de embeddings sin máscara, necesaria para llamar al proveedor.

## Reinicializar el seed

Borrar la configuración activa y su historial es destructivo: se pierden credenciales y todos los ajustes funcionales guardados. La API no migra automáticamente payloads de versiones anteriores; si una configuración cifrada antigua no cumple el esquema actual (por ejemplo, si todavía usa `responseTokenReserve`), el arranque fallará al leerla. Tras detener la API, respaldar primero lo que se necesite; luego eliminar las filas `active` para que el siguiente arranque vuelva a crear el seed mínimo vacío:

```sql
DELETE FROM runtime.config_history WHERE id = 'active';
DELETE FROM runtime.config WHERE id = 'active';
```

No se leen `AI_CONFIG`, `MCP_CONFIG`, `MCP_URLS`, `CHAT_*`, `LLM_TRACE_REQUESTS` ni variables `MEMORY_EMBEDDING_*`. Esos ajustes se administran en runtime.config.
