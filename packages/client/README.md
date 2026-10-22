# agent-runtime-client

Cliente HTTP y de streaming para integrar agent-runtime en una UI. No depende de un framework de interfaz.

> **Estado de publicación:** el workspace está marcado como `private` y todavía no se publica en npm. `npm install agent-runtime-client` no está disponible por ahora. Dentro del monorepo se instala con `npm install` desde la raíz y se compila con `npm run build -w packages/client`.

## Uso

```ts
import { createClient } from 'agent-runtime-client';

const client = createClient({
  baseUrl: 'http://localhost:3030',
  // Debe devolver el mismo token estable para todas las solicitudes de una sesión.
  getBearer: () => localStorage.getItem('token'),
  // Opcional: credenciales MCP por servidor.
  getMcpAuth: () => null,
});

const conversation = await client.conversations.create({ agentProfileId: 'profile-id' });
const page = await client.messages.list(conversation.id, { limit: 50 });

const controller = new AbortController();
const result = await client.messages.send(
  conversation.id,
  'Hola',
  {
    onTextDelta: (delta) => console.log(delta),
    onToolStart: (id, name) => console.log('tool:', id, name),
    onToolDone: (id, name, output) => console.log('done:', name, output),
    onError: (message) => console.error(message),
    onFinish: () => console.log('finish'),
  },
  controller.signal,
);
// result: 'ok' | 'aborted'
```

El cliente no crea ni conserva automáticamente una sesión anónima. Si se usa el modo anónimo del runtime, la aplicación anfitriona debe generar y conservar un identificador estable y enviar `anon:<uuid>` mediante `getBearer` en todas las solicitudes. Sin un Bearer persistente, las solicitudes no comparten identidad.

### Administración y voz Realtime

Las operaciones administrativas usan `client.admin` y reciben el encabezado de autorización de administración en cada llamada; no reutilizan el Bearer de identidad ni las credenciales MCP configuradas en el cliente:

```ts
const config = await client.admin.getRuntimeConfig(adminAuthorization);
await client.admin.saveRuntimeConfig(adminAuthorization, {
  version: config.version,
  settings: config.settings,
});
const profiles = await client.admin.listAgentProfiles(adminAuthorization);
```

`client.voice.negotiateRealtime({ realtimeUrl, token, offerSdp })` encapsula el POST SDP al proveedor Realtime. La aplicación sigue siendo responsable de WebRTC, el micrófono y el estado de la interfaz.

### Navegador

`agent-runtime-client/browser` es el bundle ESM generado por `npm run bundle -w packages/client`. Lo consume la UI nativa (`apps/ui`).

## Protocolo

Los turnos usan UI Message Stream (AI SDK). El seguimiento de delegaciones usa SSE estándar con cursores persistentes; los métodos disponibles están descritos en la tabla de API.

## API

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/conversations` | Lista conversaciones activas (`?archived=true` para archivadas). |
| `POST` | `/v1/conversations` | Crea conversación; opciones `title` y `agentProfileId`. |
| `GET` | `/v1/conversations/:id` | Obtiene conversación. |
| `PATCH` | `/v1/conversations/:id` | Actualiza título, archivo o perfil. |
| `DELETE` | `/v1/conversations/:id` | Archiva conversación. |
| `GET` | `/v1/conversations/:id/messages` | Historial paginado de mensajes. |
| `POST` | `/v1/conversations/:id/messages` | Envía texto/imágenes; devuelve UI Message Stream. |
| `GET` | `/v1/agent-profiles` | Lista perfiles activos. |
| `GET` | `/v1/models` | Lista modelos habilitados y modelo predeterminado. |
| `GET` | `/v1/delegations` | Lista delegaciones del usuario. |
| `GET` | `/v1/delegations/:id` | Consulta estado de delegación. |
| `GET` | `/v1/delegations/:id/events` | Sigue eventos de delegación vía SSE recuperable. |
| `GET` | `/admin/runtime-config` | `client.admin.getRuntimeConfig(authorization)` lee configuración administrativa. |
| `PUT` | `/admin/runtime-config` | `client.admin.saveRuntimeConfig(authorization, input)` guarda configuración versionada. |
| `POST` | `/admin/runtime-config/test-auth` | `client.admin.testAuth(authorization, input)` prueba introspección de identidad. |
| `GET` | `/admin/agent-profiles` | `client.admin.listAgentProfiles(authorization)` lista perfiles y su default. |
| `POST` | `/admin/agent-profiles` | `client.admin.createAgentProfile(authorization, profile)` crea perfil. |
| `PUT` | `/admin/agent-profiles/:id` | `client.admin.updateAgentProfile(authorization, id, profile)` actualiza perfil. |
| `DELETE` | `/admin/agent-profiles/:id` | `client.admin.archiveAgentProfile(authorization, id)` archiva perfil. |
| `PUT` | `/admin/agent-profiles/default-for-new-chats` | `client.admin.setDefaultForNewChats(authorization, profileId)` cambia el default. |
| `POST` | Proveedor Realtime | `client.voice.negotiateRealtime(input)` envía la oferta SDP al proveedor. |

Para mantener una identidad entre solicitudes `/v1`, enviá un Bearer estable; sin Bearer el servidor crea una identidad nueva para cada solicitud. `X-MCP-Auth` es opcional.
