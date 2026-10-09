# Configuración dinámica de agent-runtime (primera etapa)

La configuración operativa de `agent-runtime` vive en `runtime.config`, esquema PostgreSQL propio del runtime. Se puede compartir servidor/base con Memory MCP, pero no comparte sus tablas ni su ownership: Memory MCP conserva sus datos en `public`. Cada proceso mantiene su propio pool de conexiones.

## Alcance actual

Se guardan y recargan sin reinicio:

- Providers/modelos y modelo por defecto (`ai`).
- MCPs (`mcpConfig`).
- Configuración de embeddings (`embeddingConfig`), con API key cifrada.
- Prompt y límites del chat, resúmenes y trazas.

Los embeddings siguen usando el esquema vectorial de Memory MCP (`vector(1536)`). Por ahora solo se admiten configuraciones cuyos modelos devuelvan 1536 dimensiones. Si cambia el modelo o endpoint, Memory MCP vuelve a encolar los documentos para indexarlos con la configuración nueva. Cambiar la dimensión requiere una migración separada y reindexación.

## Activación

En `.env` configurar:

```dotenv
DATABASE_URL=postgresql://agent:agent@localhost:5433/memory?schema=public
RUNTIME_CONFIG_ENCRYPTION_KEY=<64 caracteres hex generados con openssl rand -hex 32>
RUNTIME_CONFIG_ADMIN_TOKEN=<secreto aleatorio largo>
RUNTIME_CONFIG_INTERNAL_TOKEN=<otro secreto aleatorio largo>
```

En Compose, el servicio API sustituye el host de `DATABASE_URL` por `postgres`. No se debe cambiar la clave de cifrado después de que exista configuración guardada, salvo que se implemente y ejecute una re-encriptación. Sin `RUNTIME_CONFIG_ENCRYPTION_KEY`, la API sigue en modo compatible con env, pero la configuración dinámica queda deshabilitada.

Al primer arranque se crea `runtime.config` y se carga allí una copia cifrada del subconjunto dinámico de la configuración de env; ese primer arranque necesita un `AI_CONFIG` válido con al menos un provider habilitado. Los siguientes arranques toman la versión de la DB y ya no requieren `AI_CONFIG` ni `MEMORY_EMBEDDING_CONFIG` en env. La API consulta versiones cada 3 segundos; actualiza la config activa cuando cambia. Los secretos se cifran con AES-256-GCM antes de escribirlos en PostgreSQL.

## Administración desde la UI y API

La UI nativa incluye Administración → Configuración del runtime, con secciones JSON para Chat, Providers, Embeddings y MCP. Cada pestaña muestra una guía de sus campos, ejemplos y dónde obtener claves, modelos o URLs. Lee y guarda la configuración versionada, muestra secretos enmascarados y envía la versión observada para detectar conflictos. La validación de esquema ocurre en el servidor al guardar. Cambiar modelo/endpoint de embeddings inicia la reindexación de documentos pendientes; sigue aplicando la limitación vectorial 1536.

Mientras `RUNTIME_CONFIG_ADMIN_USERS` esté vacío, la UI permite el acceso clásico con usuario y contraseña `admin` / `admin` (salvo que se hayan sobrescrito con `RUNTIME_CONFIG_BOOTSTRAP_USER` y `RUNTIME_CONFIG_BOOTSTRAP_PASSWORD`). Es un acceso temporal de bootstrap: cambialo antes de exponer el servicio. **No publiques el servicio con la contraseña predeterminada.**

Al configurar el primer `userId` y/o email en `RUNTIME_CONFIG_ADMIN_USERS`, el acceso clásico se desactiva automáticamente. La UI pasa a solicitar el access token normal del usuario; el backend lo valida con `AUTH_INTROSPECT_URL` y compara la identidad con esa allowlist. `AUTH_MAPPING` debe mapear los campos de userId/email que corresponden a la respuesta de introspección. Los tokens anónimos de chat no tienen acceso. El token de administración del runtime nunca es necesario en el navegador. Para cambiar entre modo bootstrap y modo allowlist, reiniciar la API después de editar el env.

`GET` y `PUT /admin/runtime-config` también aceptan `Authorization: Bearer <RUNTIME_CONFIG_ADMIN_TOKEN>` para operaciones automatizadas/CLI. Este secreto da control total y debe mantenerse solo en el servidor o en herramientas de confianza. Si la configuración dinámica está deshabilitada, las rutas responden 404; identidades no autorizadas reciben 403. Servir la UI y el endpoint solo por HTTPS en entornos compartidos.

- `GET /admin/runtime-config`: devuelve la configuración activa y su `version`; enmascara API keys, headers MCP y auth como `********`.
- `PUT /admin/runtime-config`: valida y persiste una nueva versión. Los campos enmascarados conservan el secreto actual. Si la versión enviada quedó desactualizada, devuelve `409`.

El body de PUT tiene esta forma: `{ "version": 3, "settings": { "ai": ..., "mcpConfig": ..., "embeddingConfig": { "apiKey": "...", "baseUrl": "https://api.openai.com/v1", "model": "text-embedding-3-small" }, "chatSystemPrompt": ..., "contextTokenBudget": ..., "maxContextMessages": ..., "responseTokenReserve": ..., "contextSafetyTokens": ..., "maxToolSteps": ..., "llmTraceRequests": ..., "summariesEnabled": ..., "summaryTokenBudget": ... } }`; enviar `embeddingConfig: null` deshabilita los embeddings. Incluir la versión de GET evita sobrescribir actualizaciones concurrentes.

Ejemplo de inspección:

```sh
curl -H "Authorization: Bearer $RUNTIME_CONFIG_ADMIN_TOKEN" \
  http://localhost:3010/admin/runtime-config
```

El trace de requests puede incluir contenido privado; habilitarlo solo de forma temporal.

Memory MCP consulta internamente `GET /internal/runtime-config/embedding` con `RUNTIME_CONFIG_INTERNAL_TOKEN`. Ese token no es el de administración; compartirlo solo entre API y Memory MCP. El endpoint devuelve únicamente la configuración de embeddings sin máscara, porque Memory MCP la necesita para llamar al proveedor. El servicio la sondea periódicamente; si no se configura el token interno, se mantiene el fallback por env en Memory MCP.

## Migración desde env

`AI_CONFIG`, `MCP_CONFIG` y los ajustes `CHAT_*` siguen siendo el bootstrap para instalaciones existentes: se usan para inicializar la fila solo si todavía no existe. Luego prevalece la base. CORS, URLs de infraestructura/auth y opciones de UI continúan en env por ahora. `DATABASE_URL` es infraestructura/bootstrap, no configuración funcional.
