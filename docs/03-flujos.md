# Flujos

## 0. De abrir el chat a la respuesta (genérico)

Esto es **un turno completo** visto desde la persona: burbuja → hilo → "enviar" → texto del modelo en pantalla. Sirve para identificado y público; lo que cambia es **quién sos** (JWT vs `anon:`) y **qué tools** hay.

```text
Identificado (JWT) / Público (anon:<uuid>)  agent-runtime              MCP + OpenRouter
  ──────────────────────────────────────           ────────                  ────────────────
  Abre la burbuja
                                GET /v1/conversations
                                lista hilos de ese dueño
                                elige último hilo o vacío
                                GET …/messages  (si hay hilo)
                                muestra historial o canvas vacío

  Escribe y Enviar
                                si no hay hilo: POST /v1/conversations
                                POST /v1/conversations/:id/messages  { text }
                                                                       1. dueño + no archivado
                                                                       2. abre MCP (Bearer + X-MCP-Auth)
                                                                       3. tools/list
                                                                       4. INSERT user (+ título si era null)
                                                                       5. arma prompt (ventana)
                                                                       6. streamText → OpenRouter
                                                                            │
                                                                            ├─ tool call → MCP → API huésped
                                                                            └─ tokens de texto
                                lee UI Message Stream
                                pinta delta a delta
                                                                       onFinish: INSERT tool* + assistant
                                burbuja assistant completa
```

### Paso a paso

1. **Abrir.** Identificado: JWT en `Authorization`. Público: `anon:<uuid>` en `Authorization` (se genera y persiste en `localStorage('chat_session_id')`).
2. **Quién sos.** Cada request a `/v1` pasa por `requirePrincipal`:
   - `anon:<uuid>` → ese uuid es el `userId` (sin lookup: la API no tiene database)
   - JWT → introspección huésped → `userId`
   - Sin Bearer → uuid nuevo por request (backward compat)
3. **Qué hilo.** `GET /v1/conversations`. La UI reabre el último id local o el más reciente. Si no hay ninguno, el canvas queda vacío hasta el primer envío.
4. **Historial.** Si hay hilo: `GET /v1/conversations/:id/messages`. La UI muestra `user` / `assistant` / `tool`; el modelo **todavía no corre**.
5. **Enviar.** `POST /v1/conversations/:id/messages` con `{ "text": "…" }`. Si no había id, la UI crea el hilo **antes**. Texto 1–100.000 caracteres. Archivado → 409.
6. **Persistir el usuario.** Se inserta `role=user`. Si `title` era `null`, se recorta ese texto (sin LLM) y queda el título del sidebar.
7. **Prompt.** Se leen hasta 500 mensajes del hilo, se recortan al presupuesto de tokens, se antepone el system prompt.
8. **Modelo.** OpenRouter genera. Puede intercalar tools (MCP con Bearer + X-MCP-Auth). Tope `CHAT_MAX_TOOL_STEPS`. El HTTP **no** es un JSON final: es stream.
9. **Pantalla.** La UI consume el stream y va pegando texto. "Parar" aborta el request; lo ya generado se guarda igual.
10. **Cierre.** Al terminar (o abortar): filas `tool` si hubo llamadas + `assistant` con el texto. Se cierra el cliente MCP. `updated_at` del hilo.

Hasta el paso 4 **no hay LLM**. El modelo solo entra en el `POST` de mensajes.

Un segundo mensaje en el **mismo** hilo salta 1–3: mismo Bearer, mismo `:id`, historial más largo en el prompt.

Detalle interno del `POST` (auth, MCP, persist): sección 1.

## 0.1. Contrato Bearer y MCP Auth

### Authorization header

| Formato | Ejemplo | Interpretación |
|---------|---------|----------------|
| `Bearer anon:<uuid>` | `Bearer anon:550e8400-...` | Session anónima → `userId = uuid` |
| `Bearer <jwt>` | `Bearer eyJhbGciOiJIUzI1NiIs...` | Identificado → introspección en `AUTH_INTROSPECT_URL` |
| Sin header | — | Session anónima nueva (backward compat) |

El prefijo `anon:` es el contrato: nunca colisiona con JWTs (que tienen puntos). El server hace `stripPrefix('anon:')` y usa el UUID como `userId`. No se persiste: la session es lo que guarda el cliente.

### X-MCP-Auth header

Header opcional JSON:
```
X-MCP-Auth: {"memory":"token-mem","files":"token-files"}
```

El server lo parsea y pasa a `McpRegistry.connect(accessToken, mcpAuth)`. Cada MCP recibe su token si está en el mapa, o el `accessToken` principal si no.

### Configuración en cliente

```js
// localStorage
localStorage.setItem('chat_session_id', crypto.randomUUID());
localStorage.setItem('chat_mcp_auth', JSON.stringify({
  memory: 'token-para-memory-mcp',
  files: 'token-para-files-mcp',
}));
```

## 1. Turno identificado (detalle interno)

Precondiciones: Identificado logueado en Admin; el drawer manda `Authorization: Bearer <accessToken>`. Existe un hilo del mismo `userId` (o se acaba de crear).

```text
1. POST /v1/conversations/:id/messages
   { "text": "¿Puede entrar Juan Pérez?" }

2. requirePrincipal
   → token JWT (no anon:)
   → GET AUTH_INTROSPECT_URL (o cache 30s)
   → userId

3. getConversation (dueño). No archivada.

4. McpRegistry.connect(accessToken, mcpAuth)
   → cada MCP con su auth

5. INSERT message role=user
   applyAutomaticTitle si title IS NULL
   SELECT messages del hilo → buildModelMessages (ventana)

6. streamText(OpenRouter, system=SYSTEM_PROMPT, tools, abortSignal)
   el modelo puede llamar tools (MCP con el Bearer)
   cada tool: MCP → API huésped con el mismo Bearer

7. SSE / UI Message Stream hacia el drawer
   onFinish: INSERT role=tool (args+result) + role=assistant
   close MCP
```

Postcondición: el hilo tiene el mensaje del usuario, filas tool si hubo llamadas, y el texto del asistente. `updated_at` al día.

### Variante: "Parar"

El browser aborta el `fetch`. `AbortSignal` corta `streamText`. `onAbort` persiste steps ya acumulados (tools y texto parcial si hubo). No se muestra error de LLM.

## 2. Alta de hilo identificado

```text
POST /v1/conversations
{ "title": opcional }

→ 201 { id, userId, title, archivedAt, createdAt, updatedAt }
```

Sin mensajes. El título automático llega en el **primer** `POST .../messages` si `title` sigue `null`.

Listado: `GET /v1/conversations` (activos) o `?archived=true`. `PATCH` título o `archived`. `DELETE` = archivar.

## 3. Público (sin JWT)

```text
Visitante sin login

1. POST /v1/conversations/:id/messages  (con Bearer anon:<uuid>)
   → requirePrincipal detecta anon: → Principal {userId: uuid}
   → MCP tools disponibles (según MCP)
   → system = SYSTEM_PROMPT
   → 502 genérico si MCP cae ("El asistente no está disponible.")

Recargas el navegador:
1. POST /v1/conversations/:id/messages  (mismo anon:<uuid>)
   → mismo userId
   → conversaciones anteriores visibles
```

Session anónima: dura lo que dure `chat_session_id` en el `localStorage` del navegador. Sin vencimiento del lado del server.

## 4. Qué ve el modelo vs qué queda en DB

```text
DB (completo)                    Prompt (recortado)
─────────────                    ──────────────────
user: "buscá a Juan"             system (env, siempre)
tool: JSON de 80 resultados        →  "search → 80 hits"  (si es viejo)
assistant: "Hay varios…"         assistant igual
user: "el DNI 123"               user igual (si entra en el presupuesto)
```

Las dos tools más nuevas se mandan más enteras. Si el hilo es enorme, los mensajes **viejos no van al modelo** pero siguen en `GET .../messages` para la UI.

## 5. Errores frecuentes

| Situación | Código | Mensaje típico |
|-----------|--------|----------------|
| Sin Bearer / token malo / introspect 401 | 401 | Unauthorized |
| Introspect caído / timeout / 5xx | 502 | Auth introspection unavailable |
| Hilo de otro usuario o UUID inexistente | 404 | Conversation not found |
| Texto vacío / JSON inválido / UUID malo | 400 | … |
| Hilo archivado | 409 | Conversation archived |
| MCP o OpenRouter no arrancan | 502 | El asistente no está disponible. |
| Postgres caído en /health | 503 | `status: degraded` |

Errores **durante** el stream (crédito OpenRouter, 429, contexto, timeout) van en el protocolo UI Message Stream, no siempre como HTTP 502. El mapper está en `llm/errors.ts`.

## 6. CORS y túnel

El panel en `{slug}.localhost:3002` o `{slug}.faciliter.xyz` manda `Origin`. `agent-runtime` solo refleja orígenes de `CORS_ORIGIN`, `*.localhost` o `CORS_APP_DOMAIN`. Tras cambiar `.env`, **recrear** el contenedor (`env_file` no se recarga con un restart).

Logout del Admin tira el JWT: el chat deja de introspectar bien. No hay sesión propia que sobreviva.

## 7. Relación con el huésped (fuera de este paquete)

| Pieza | Dónde | Rol |
|-------|--------|-----|
| Drawer / burbuja | `apps/ui` o la UI del huésped (con `packages/client`) | UI, chips `links`, botón Parar |
| MCP | Sidecar del huésped | Tools → HTTP API; cada MCP valida su auth |
| Auth | Huésped | `/auth/me` + APIs de negocio |

`agent-runtime` no importa esos repos; Compose los une por red y env.

[← Módulos](./02-modulos.md) · [Índice](./00-indice.md) · [HTTP →](./04-http.md)
