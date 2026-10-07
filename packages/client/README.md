# agent-runtime-client

Cliente genérico para integrar agent-runtime en cualquier UI.

## Instalación

```bash
npm install agent-runtime-client
```

## Uso

### Cliente core (cualquier framework)

```ts
import { createClient } from 'agent-runtime-client';

const client = createClient({
  baseUrl: 'http://localhost:3010',
  getBearer: () => localStorage.getItem('token'),
});

// Conversaciones
const conversations = await client.conversations.list();
const conv = await client.conversations.create();
await client.conversations.archive(conv.id);

// Modelos elegibles (ids "proveedor/modelo")
const { default: defaultModel, items } = await client.models.list();

// Stream de un turno
const controller = new AbortController();
const result = await client.messages.send(
  conv.id,
  'Hola',
  {
    onTextDelta: (delta) => console.log(delta),
    onToolStart: (id, name) => console.log('tool:', name),
    onToolDone: (id, name, output) => console.log('done:', name, output),
    onError: (msg) => console.error(msg),
    onFinish: () => console.log('finish'),
  },
  controller.signal,
  { model: defaultModel },
);
// result: 'ok' | 'aborted'
```

### Navegador

`agent-runtime-client/browser` es el mismo cliente empaquetado en un solo archivo ESM (`npm run bundle`). Es el que usa la UI nativa (`apps/ui`).

## Protocolo

Usa el UI Message Stream del AI SDK (SSE con bloques `data: ...`).
No requiere SSE estándar — el runtime devuelve el formato del AI SDK.

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/v1/conversations` | Lista hilos |
| POST | `/v1/conversations` | Crea hilo |
| DELETE | `/v1/conversations/:id` | Archiva |
| PATCH | `/v1/conversations/:id` | Título/archivado |
| GET | `/v1/conversations/:id/messages` | Historial |
| POST | `/v1/conversations/:id/messages` | Envía mensaje (stream). Body `{ text, model? }` |
| GET | `/v1/models` | Modelos elegibles y default |
