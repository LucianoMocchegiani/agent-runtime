# Perfiles de agente

La configuración de comportamiento del agente y su modelo viven en `runtime.agent_profile_configs`, propiedad de Runtime. Memory es dueño de las conversaciones y no almacena perfiles ni asignaciones. Por ahora, Runtime aplica un único perfil global a todas las conversaciones; los demás perfiles se conservan para preparar el futuro uso multiagente.

Los campos antiguos de chat/modelo en `runtime.config` se leen únicamente durante la migración inicial para crear el perfil `Predeterminado`. Después quedan congelados: el endpoint global ya no permite modificarlos y los turnos no los consultan. El perfil activo es la fuente de comportamiento para todos los turnos.

## Perfil global activo

Los perfiles activos se ordenan por `sort_order`, `created_at` e `id`. El primero es el perfil global activo. Cambiar su configuración o mover otro perfil al primer lugar afecta los próximos turnos de todas las conversaciones, incluidas las ya existentes. No se guarda una asociación perfil-conversación.

En la primera inicialización se crea `Predeterminado`, copiando al perfil los valores de chat y el modelo de la configuración activa anterior. La API no altera el esquema de conversaciones de Memory. Si se archiva el perfil global, el siguiente perfil activo pasa a ser el perfil global.

## Configuración del perfil

Cada perfil contiene `modelId` y `config`, con prompt, límites de contexto/salida, pasos de herramientas, trazas y resúmenes. El modelo debe estar habilitado en los providers del runtime. Las credenciales, MCPs y embeddings siguen siendo infraestructura global; no son datos propios del perfil. Los límites de seguridad globales tampoco se relajan desde perfiles.

Solo las identidades autorizadas para administración pueden crear, editar, reordenar o archivar perfiles. La UI permite seleccionar un perfil para editarlo; esa selección no lo activa. Usá «Activar globalmente» para aplicarlo a todas las conversaciones. El envío de un modelo desde el navegador se rechaza: el servidor resuelve siempre el modelo desde el perfil global activo.

## API administrativa

`GET /admin/agent-profiles` devuelve perfiles activos. `POST /admin/agent-profiles` crea uno; `PUT /admin/agent-profiles/:id` actualiza los campos `name`, `modelId`, `sortOrder` y `config`; `POST /admin/agent-profiles/:id/activate` establece el perfil global activo; `DELETE /admin/agent-profiles/:id` archiva el perfil. Todas requieren la misma autorización administrativa que `/admin/runtime-config`.

## Interfaz de administración

La pantalla **Configuración del runtime** organiza la edición en cuatro pestañas:

- **Profiles**: selector del perfil a editar, activación global, creación, edición JSON y archivado. El primero por orden se aplica globalmente.
- **Provider**: proveedores, credenciales y modelos que pueden elegirse desde un perfil.
- **Embedding**: configuración global del proveedor de embeddings.
- **MCP**: configuración global de servidores MCP.

La interfaz de chat no incluye selector de perfil; todas las conversaciones usan el perfil global activo. La guía integrada de Profiles explica esta limitación temporal y cómo cambiar el perfil global.

La UI de administración está implementada en `apps/ui/src/AdminConfig.jsx`; las guías contextuales, incluida la de Profiles, están en `apps/ui/src/AdminConfigHelp.jsx`.
