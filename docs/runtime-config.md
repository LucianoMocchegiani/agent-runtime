# Configuración dinámica de agent-runtime

`runtime.config` guarda configuración global de infraestructura en un esquema PostgreSQL propio del runtime. Puede compartir servidor y base con Memory MCP, pero no comparte sus tablas ni ownership: Memory MCP conserva sus datos en `public`. Cada proceso mantiene su propio pool.

El modelo y el comportamiento del agente viven en perfiles de `runtime.agent_profile_configs`, propiedad de Runtime. Por ahora, el primer perfil activo por orden se aplica globalmente a todas las conversaciones; Memory no guarda ni conoce esa configuración. Ver [Perfiles de agente](./agent-profiles.md).

## Alcance

Se guardan y recargan sin reiniciar:

- Providers habilitados y credenciales (`ai.providers`). Los modelos seleccionables se validan contra sus listas.
- MCPs globales (`mcpConfig`).
- Configuración global de embeddings (`embeddingConfig`), con API key cifrada.

Los embeddings usan el esquema vectorial de Memory MCP (`vector(1536)`). Solo se admiten modelos que devuelvan 1536 dimensiones. Si cambia el modelo o endpoint, Memory MCP vuelve a encolar documentos para indexarlos con la configuración nueva. Cambiar la dimensión requiere una migración y reindexación separadas.

## Primer inicio y migración

La API crea el esquema/tablas de `runtime.config` cuando no existen. En instalaciones nuevas, el seed no contiene credenciales ni proveedores habilitados; también crea un perfil `Predeterminado` con los valores iniciales de chat/modelo.

En una instalación existente, los valores anteriores de modelo y comportamiento se copian al perfil inicial. Las conversaciones previas y nuevas permanecen bajo propiedad de Memory, sin asignación de perfil. En cada turno, la API consulta el primer perfil activo ordenado por `sort_order`, `created_at` e `id`. Los ajustes antiguos de chat/modelo que sigan en el payload global son solo compatibilidad de migración: no pueden cambiarse mediante el endpoint de runtime y no se consultan para ejecutar turnos.

La API crea `runtime.agent_profile_configs` dentro del esquema de Runtime y no modifica `public.conversations`. Memory MCP contiene una migración de limpieza que elimina la columna de asignación que se había agregado anteriormente.

## Requisitos de infraestructura

Configurar en `.env`:

```dotenv
DATABASE_URL=postgresql://agent:agent@localhost:5433/memory?schema=public
RUNTIME_CONFIG_ENCRYPTION_KEY=<64 caracteres hex generados con openssl rand -hex 32>
RUNTIME_CONFIG_INTERNAL_TOKEN=<secreto aleatorio largo>
```

`DATABASE_URL` y `RUNTIME_CONFIG_ENCRYPTION_KEY` son obligatorias. Guardar una copia segura de la clave y no cambiarla mientras haya configuración cifrada. `RUNTIME_CONFIG_INTERNAL_TOKEN` se comparte entre API y Memory MCP para consultar embeddings; si falta, Memory sigue en búsqueda textual.

En Compose, el servicio API usa el host `postgres`. La API consulta versiones cada 3 segundos y aplica cambios de infraestructura publicados por la UI/API sin reiniciar. Los secretos se cifran con AES-256-GCM antes de escribirlos en PostgreSQL.

## Administración

La UI tiene una sección **Perfiles de agente** para activar globalmente, crear, editar, reordenar y archivar perfiles. El primer perfil activo por `sort_order`, `created_at` e `id` se usa globalmente para todas las conversaciones. Reordenar o editar el perfil activo modifica los próximos turnos de todas ellas. La selección del perfil en la pantalla de administración solo elige cuál editar; el chat no ofrece selección por conversación. Solo admins pueden administrar los perfiles; el backend valida permisos, modelos habilitados y límites.

La sección restante de Administración queda para proveedores/credenciales, embeddings y MCPs globales. No es la fuente del modelo ni de la configuración de chat. Solo el primer perfil es seed inicial; si se archiva el perfil global, el siguiente pasa a ser el activo.

Mientras `RUNTIME_CONFIG_ADMIN_USERS` esté vacío, la UI permite acceso clásico con usuario y contraseña `admin` / `admin` (se pueden sobrescribir con `RUNTIME_CONFIG_BOOTSTRAP_USER` y `RUNTIME_CONFIG_BOOTSTRAP_PASSWORD`). Cambiar esos valores y asegurar el acceso antes de exponer el servicio.

Al configurar el primer `userId` y/o email en `RUNTIME_CONFIG_ADMIN_USERS`, el acceso clásico se desactiva. La UI solicita el access token normal del usuario; el backend lo valida con `AUTH_INTROSPECT_URL` y compara la identidad con la allowlist. Los tokens anónimos no tienen acceso administrativo. El token de administración del runtime nunca se entrega al navegador.

`GET` y `PUT /admin/runtime-config` aceptan también `Authorization: Bearer <RUNTIME_CONFIG_ADMIN_TOKEN>` para automatización. El endpoint expone/actualiza solo configuración global de infraestructura; cambios sobre el modelo o los campos de chat antiguos no los convierten en una fuente alternativa para perfiles. Proteger este secreto y usar HTTPS en entornos compartidos.

Memory MCP consulta internamente `GET /internal/runtime-config/embedding` con `RUNTIME_CONFIG_INTERNAL_TOKEN`. Devuelve solo la configuración de embeddings sin máscara.

## Reinicializar

Borrar la fila activa y el historial es destructivo: se pierden credenciales y configuración de infraestructura. Antes de hacerlo, detener la API y respaldar lo necesario. Los perfiles no están asociados a conversaciones y pertenecen al esquema de Runtime.

```sql
DELETE FROM runtime.config_history WHERE id = 'active';
DELETE FROM runtime.config WHERE id = 'active';
```
