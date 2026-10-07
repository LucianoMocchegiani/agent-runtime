# Agent Runtime — Arquitectura y Decisiones

## 1. Visión general

Agent Runtime es un entorno de ejecución genérico para agentes de IA. No está acoplado a un dominio, base de datos o sistema de memoria específico. La aplicación expone capacidades via MCP; el runtime ejecuta el agente y orquesta la conversación.

```
                      AGENT RUNTIME
                           |
                    Model Interface   MCP Client
                           |              |
                    +------+------+  +----+----+
                    |             |  |         |
                  OpenRouter   Ollama  Memory   Domain MCPs
                                |  MCP      MCP     MCP
```

---

## 2. Principios activos

| Principio | Aplicación |
|---|---|
| Runtime agnóstico del dominio | No hay lógica de dominio en el runtime |
| Memoria externa | El runtime no persiste; consume un Memory MCP |
| Provider swapable | AI SDK abstrae el modelo; OpenRouter es default, no dependencia |
| MCP como frontera | Todo acceso a capacidades externas pasa por MCP |
| Identidad delegada | El dominio interpreta `userId`; el runtime solo pasa `userId` a memory |
| Auth por MCP | Cada MCP valida su propio Bearer |

---

## 3. Patrones de diseño

### Adapter
`Memory MCP client` adapta el protocolo MCP al contrato que el runtime necesita (`getContext`, `saveMessage`, `listMessages`). El runtime no conoce Prisma ni la implementación del MCP.

### Repository (virtual)
Las operaciones de memoria (`listMessages`, `insertUserMessage`, etc.) se exponen como si fueran un repositorio, pero la implementación real es un MCP remoto.

### Strategy
Proveedores de modelo: `chatModel()` retorna un modelo según configuración. Swappable sin tocar el agent loop.

### Middleware (Hono)
Auth (`requirePrincipal`), CORS, rate-limit son middlewares desacoplados del negocio.

---

## 4. Tecnologías

| Capa | Tecnología | Rol |
|---|---|---|
| Runtime | Node 24 + tsx | Ejecución |
| HTTP | Hono | Router, middleware, SSE |
| LLM | AI SDK + OpenRouter | Inferencia, tool calling, streaming |
| MCP | `@ai-sdk/mcp` | Conexión via `MCP_CONFIG` (url + auth por MCP) |
| DB (default memory) | Prisma + PostgreSQL | Solo Memory MCP default |
| Auth | Introspección HTTP + HMAC | Bearer token validation |
| Rate limit | In-memory Map | Por instancia |

---

## 5. Rendimiento

### Agent loop
- `streamText` de AI SDK con streaming UI Message Stream
- `stopWhen: steps >= maxToolSteps` (default 8) evita loops infinitos
- `contextTokenBudget` (default 10_000) recorta ventana sin borrar filas

### Memory MCP
- Cada operación es un round-trip HTTP al MCP server
- `getContext` debe ser la operación más pesada: conviene batching interno en el MCP
- El client MCP se crea por request — sin connection pooling a nivel de runtime

### Ventana de contexto
- `buildModelMessages` recorre las mensajes de atrás para adelante hasta llenar el budget
- Tools viejas se achican (`shrinkToolContent`): últimas 2 con detalle, el resto resumidas
- Estimación: 1 token ≈ 4 chars (aproximación, no exacta)

---

## 6. Concurrencia

### What works
- Hono maneja concurrent requests por event loop (Node.js)
- Cada request crea su propio MCP client — no hay shared mutable state en el agent loop
- La API no tiene database ni estado propio: escala sin coordinar nada entre instancias (salvo rate limit)

### What doesn't
- **Rate limit**: `Map<string, Bucket>` en memoria. Solo funciona en una instancia. No sirve para horizontal scaling.
- **MCP client**: no es connection-pooled. Muchos requests simultáneos = muchas conexiones HTTP al MCP server.
- **Prisma (memory-mcp)**: una instancia del client por proceso. Under high concurrency puede saturar la DB connection pool (ajustar `datasource` connections).

### Escalado horizontal
Para múltiples instancias del runtime se necesita:
- Redis o KV para rate limit compartido
- Memory MCP puede ser stateless si usa DB compartida (PostgreSQL)
- MCP connections se multiplican por instancia (considerar connection limits del MCP server)

---

## 7. Limitaciones conocidas

| Limitación | Impacto | Mitigación |
|---|---|---|
| Rate limit in-memory | No funciona en horizontal | Redis en futuro |
| MCP client sin pool | Muchas conexiones en concurrency alta | Reuse client por request, no por call |
| `shrinkToolContent` heuristic | Perdida de info en tools grandes | Ajustar budget, no confiar en recorte |
| Token estimation `len/4` | Inexacto para tokens reales | AI SDK tiene `countTokens`; usar en futuro |
| Memory MCP como punto único | Si cae, runtime no persiste ni lee | Retry + circuit breaker (futuro) |
| Memory MCP sin auth propia | Quien llegue al puerto lee/escribe cualquier `userId` | Red interna (Compose) o `127.0.0.1` (default fuera de Docker) |
| API key del modelo (`AI_CONFIG.apiKey`) fija en env | No rotación dinámica | Vault / secrets manager (futuro) |

---

## 8. Estructura actual del código

```
apps/api/src/                 # API: sin database
  ├── app.ts                  # Hono app, CORS, /health, /v1 autenticado, UI
  ├── index.ts                # Entry point
  ├── config.ts               # Env parsing, sin dominio específico
  ├── ui.ts                   # UI nativa + fallback SPA
  ├── agent/
  │   ├── run.ts              # Agent loop: MCP + LLM + persist
  │   └── window.ts           # Construcción de mensajes para el modelo
  ├── llm/
  │   ├── provider.ts         # Catálogo AI_CONFIG + resolveModel
  │   ├── openai.ts / openrouter.ts
  │   ├── routes.ts           # GET /v1/models
  │   └── errors.ts           # Mapeo de errores a mensajes identificado
  ├── mcp/
  │   └── registry.ts         # Pool MCP multi-conexión
  ├── memory/                 # cliente Memory MCP
  │   ├── client.ts
  │   └── errors.ts
  ├── messages/
  │   └── routes.ts           # Usa memory-client
  ├── conversations/
  │   ├── service.ts          # CRUD → memory-client
  │   ├── routes.ts
  │   └── ids.ts
  ├── auth/
  │   ├── principal.ts        # Tipo Principal
  │   ├── middleware.ts       # Auth middleware (identificado + anónimo)
  │   └── introspect.ts       # Introspección token (cache 30s)
  └── cors.ts                 # Config CORS

apps/memory-mcp/              # Memory MCP default: dueño de la DB `memory`
  ├── prisma/                 # schema + migraciones (conversations, messages)
  └── src/
      ├── index.ts            # Entry point (127.0.0.1:3012 por default)
      ├── server.ts           # Hono + McpServer stateless
      ├── tools.ts            # Persistencia Prisma, ownership por userId
      ├── title.ts            # Título automático
      ├── setup-db.ts         # CREATE DATABASE + migrate deploy
      └── config.ts

packages/memory-contract/     # Tools + DTOs + interfaz MemoryMcp (compartido)
```

---

## 9. Flujo de un turno

```
User → POST /v1/conversations/:id/messages
  → streamAgentTurn(conversationId, principal, accessToken, text, systemPrompt, signal, mcpTokens)
    → memoryClient.saveMessage(convId, 'user', text)    # Memory MCP
    → memoryClient.getContext(convId)                   # Memory MCP
    → McpRegistry.connect(accessToken, mcpTokens)       # Domain MCPs
    → mcp.tools()
    → streamText(model, messages, tools)
    → memoryClient.saveMessage(convId, 'assistant', text)  # Memory MCP
```

---

## 10. Decisiones pendientes

- [ ] Contrato exacto del Memory MCP (herramientas vs resources)
- [ ] Formato de transporte MCP (stdio vs HTTP)
- [ ] Estrategia de migración de datos existentes
- [ ] Retry policy para Memory MCP caído
- [ ] Logging/observabilidad de llamadas MCP
- [ ] Compaction: quién la orquesta (runtime o Memory MCP)
