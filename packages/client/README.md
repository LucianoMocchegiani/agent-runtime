# agent-runtime-client

Cliente HTTP y de streaming para integrar agent-runtime en una UI. No depende de un framework de interfaz.

> **Estado de publicación:** el workspace está marcado como `private` y todavía no se publica en npm. `npm install agent-runtime-client` no está disponible por ahora. Dentro del monorepo se instala con `npm install` desde la raíz y se compila con `npm run build -w packages/client`.

## Uso

```ts
import { createClient } from 'agent-runtime-client';

const client = createClient({
  baseUrl: 'http://localhost:3010',
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

Para mantener una identidad entre solicitudes `/v1`, enviá un Bearer estable; sin Bearer el servidor crea una identidad nueva para cada solicitud. `X-MCP-Auth` es opcional.
