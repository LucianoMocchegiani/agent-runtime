# Memory — Módulo integrado de Agent Runtime

## Estado actual de implementación

Memory es un módulo interno del mismo proceso que Runtime. No se levanta un servidor MCP, puerto ni proceso aparte, y la API realiza llamadas directas a sus operaciones. Las menciones posteriores a “Memory MCP” y los diagramas de protocolo de este documento son conceptos históricos y no describen el transporte actual.

## 1. Objetivo

El módulo **Memory** administra conversaciones y mensajes, recuerdos y preferencias, resúmenes y recuperación de contexto. Runtime coordina los turnos del agente y consume Memory directamente. Las herramientas MCP se reservan para integraciones externas.

```text
Runtime API (un proceso)
  ├── Agent Loop / perfiles
  └── módulo Memory ── Prisma ── PostgreSQL
```

Memory conserva su propio dominio, contrato de tipos, Prisma y migraciones. Compartir proceso no elimina la separación de responsabilidades.

---

# 2. Memory como módulo interno

La implementación del módulo, su schema Prisma y las migraciones viven en `packages/memory`. Runtime lo consume directamente dentro del proceso de la API; PostgreSQL es el servicio independiente que persiste los datos.

---

# 3. Implementación incluida

El proyecto proporciona y mantiene Memory como un paquete interno de dominio. El usuario puede iniciar Agent Runtime sin construir ni configurar un sistema de memoria aparte.

```text
Agent Runtime
   ├── API / Agent Loop
   └── paquete packages/memory
           └── PostgreSQL
```

La base de datos y las migraciones de conversaciones y mensajes son responsabilidad del paquete `packages/memory` incluido en el repositorio.

# 4. Session vs Memory

Es importante diferenciar **Session** de **Memory**.

### Session

Representa el estado de una ejecución o conversación.

Puede contener:

* mensajes
* tool calls
* resultados
* metadata
* checkpoints
* estado temporal
* resumen de contexto

```text
Session
 ├── messages
 ├── tool calls
 ├── state
 ├── checkpoint
 └── summary
```

### Memory

Representa información que puede sobrevivir a una sesión.

Por ejemplo:

```text
Memory
 ├── user preferences
 ├── facts
 ├── decisions
 ├── project context
 ├── learned information
 └── important events
```

Por lo tanto:

```text
Session
    ↓
ejecución actual

Memory
    ↓
conocimiento persistente
```

Una sesión puede generar nuevas memorias.

---

# 5. Compaction

La **compaction** es un mecanismo para reducir el tamaño del contexto cuando la conversación se acerca al límite de la ventana del modelo.

No debe confundirse con Memory.

```text
Conversation
      |
      | contexto crece
      ▼
Context Window
      |
      | alcanza límite
      ▼
Compaction
      |
      ▼
Summary / compressed context
```

La compaction transforma el contexto actual en una representación más pequeña.

Memory, en cambio, permite conservar información que debe sobrevivir más allá de esa ventana.

---

# 6. Memory + Compaction

El Memory MCP puede participar en el ciclo de compaction.

Una posible secuencia:

```text
Agent Runtime
      |
      ▼
Context Window
      |
      | alcanza threshold
      ▼
Memory MCP
      |
      ├── identificar información importante
      ├── guardar memorias relevantes
      ├── guardar checkpoint
      └── generar/resguardar summary
      |
      ▼
Compaction
      |
      ▼
Nuevo Context Window
```

Esto permite que una compaction no implique simplemente:

> "Eliminar mensajes antiguos."

En cambio:

> "Reducir el contexto actual preservando la información relevante."

---

# 7. Checkpoints

El Memory MCP debería poder almacenar checkpoints de una sesión.

Un checkpoint puede representar:

```text
Checkpoint
 ├── session_id
 ├── timestamp
 ├── summary
 ├── current_state
 ├── important_context
 └── metadata
```

Esto permite recuperar una ejecución después de:

* compaction
* reinicio del Runtime
* desconexión
* cambio de modelo
* pausa de una sesión
* ejecución prolongada

Ejemplo:

```text
Session 123
     |
     ├── messages 1-50
     ├── checkpoint A
     |
     ├── messages 51-100
     ├── checkpoint B
     |
     └── current state
```

---

# 8. Recuperación de contexto

El Memory MCP debería poder responder preguntas como:

```text
¿Qué información relevante tengo sobre este usuario?

¿Qué decisiones tomó anteriormente?

¿Qué contexto tiene este proyecto?

¿Qué ocurrió en la última sesión?

¿Qué información debería incluirse en el contexto actual?
```

El Runtime puede solicitar:

```text
getContext({
  userId,
  sessionId,
  task,
  tokenBudget
})
```

Y Memory MCP devuelve un contexto optimizado para la ejecución.

---

# 9. Retrieval

El Memory MCP puede utilizar retrieval internamente.

Por ejemplo:

```text
Memory MCP
    |
    ├── PostgreSQL
    ├── Full-text search
    ├── Vector search
    └── Metadata filters
```

El Runtime no necesita conocer cómo se realiza el retrieval.

Solamente solicita:

```text
recall(...)
```

o:

```text
getContext(...)
```

Esto permite cambiar la implementación interna sin modificar el Runtime.

---

# 10. RAG dentro de Memory

Memory puede utilizar RAG internamente cuando sea necesario.

```text
Agent Runtime
      |
      ▼
Memory MCP
      |
      ├── Retrieval
      ├── Embeddings
      ├── Vector DB
      └── Memory Store
```

Sin embargo:

> **Memory RAG no significa que todo RAG deba vivir en Memory.**

Un dominio puede tener su propio RAG.

Por ejemplo:

```text
Agent Runtime
      |
      ├── Memory MCP
      │      └── User memories
      │
      ├── Gym MCP
      │      └── Gym knowledge RAG
      │
      └── Docs MCP
             └── Documentation RAG
```

Cada sistema recupera el conocimiento que posee.

---

# 11. Tipos de memoria

El Memory MCP puede soportar diferentes tipos de información.

### Episodic Memory

Eventos o experiencias anteriores.

```text
"El usuario pidió modificar el proyecto X."
```

### Semantic Memory

Hechos persistentes.

```text
"El proyecto utiliza PostgreSQL."
```

### Preference Memory

Preferencias.

```text
"El usuario prefiere respuestas concisas."
```

### Project Memory

Contexto de un proyecto.

```text
"El backend utiliza NestJS."
```

### Session Memory

Información relevante para una sesión concreta.

```text
"Estamos trabajando actualmente en el módulo de autenticación."
```

La implementación puede utilizar diferentes estructuras internamente, pero el Runtime no debería necesitar conocerlas.

---

# 12. API conceptual

El Memory MCP puede exponer herramientas similares a:

```text
Session
├── createSession()
├── getSession()
├── updateSession()
├── checkpointSession()
└── closeSession()

Memory
├── remember()
├── recall()
├── updateMemory()
├── forget()
└── listMemories()

Context
├── getContext()
└── compactContext()
```

No necesariamente todas deben ser herramientas MCP.

Algunas operaciones podrían ser resources u otros mecanismos según el diseño final.

El objetivo es definir un contrato claro, no imponer una implementación.

---

# 13. Ejemplo de flujo

Una ejecución típica:

```text
User
  |
  ▼
Agent Runtime
  |
  ├── consulta Memory MCP
  |       |
  |       └── contexto relevante
  |
  ├── consulta Model
  |
  ├── ejecuta MCPs
  |
  ├── recibe resultados
  |
  ├── responde al usuario
  |
  └── Memory MCP
          |
          ├── guarda conversación
          ├── actualiza memoria
          └── actualiza session state
```

---

# 14. Context Budget

Una característica importante puede ser permitir que el Runtime indique cuánto contexto puede recibir.

Por ejemplo:

```text
getContext({
  sessionId: "...",
  tokenBudget: 8000
})
```

Memory MCP puede decidir qué información devolver dentro de ese presupuesto.

```text
Memory MCP
     |
     ├── recent messages
     ├── important memories
     ├── relevant historical context
     └── summary
              |
              ▼
          8000 tokens
```

La selección de información relevante es responsabilidad del componente Memory MCP y se coordina con Runtime mediante el contrato interno compartido.

---

# 15. Identidad y aislamiento

El Memory MCP debe respetar la identidad proporcionada por el sistema consumidor.

Por ejemplo:

```text
tenant_id
user_id
agent_id
session_id
project_id
```

La memoria debe estar aislada según el modelo de identidad de la aplicación.

Ejemplo:

```text
Tenant A
 ├── User 1
 │    └── Memories
 │
 └── User 2
      └── Memories

Tenant B
 └── User 1
      └── Memories
```

El Runtime no debería asumir cómo se representan internamente los usuarios.

El Memory MCP debe interpretar la identidad según el sistema que lo utiliza.

---

# 16. Múltiples Memory MCP

El Runtime no debería asumir que existe una única memoria.

Puede conectarse a varias:

```text
Agent Runtime
      |
      ├── Personal Memory MCP
      ├── Company Memory MCP
      ├── Project Memory MCP
      └── Application Memory MCP
```

Esto permite diferentes fuentes de contexto.

La composición y prioridad entre memorias puede quedar a cargo del integrador.

El Runtime proporciona las capacidades necesarias para utilizarlas, pero no necesita imponer una única arquitectura de memoria.

---

# 17. Persistencia

El Memory MCP puede utilizar cualquier almacenamiento.

Por ejemplo:

```text
Memory MCP
   |
   +── PostgreSQL
   +── SQLite
   +── MongoDB
   +── Vector DB
   +── Object Storage
   └── custom storage
```

La base de datos es un detalle de implementación.

El contrato importante es:

```text
Agent Runtime
      |
      ▼
Memory MCP
```

no:

```text
Agent Runtime
      |
      ▼
PostgreSQL
```

---

# 18. Relación con Agent Runtime

El Agent Runtime debería ser responsable de:

* ejecutar el agent loop
* seleccionar el modelo
* ejecutar MCPs
* controlar el ciclo de ejecución
* gestionar el contexto inmediato
* detectar cuándo necesita contexto adicional
* detectar cuándo realizar compaction

El Memory MCP debería ser responsable de:

* persistir sesiones
* persistir memorias
* recuperar contexto
* gestionar checkpoints
* realizar retrieval
* mantener el conocimiento persistente
* ayudar a preservar información durante compaction

```text
                AGENT RUNTIME
                      |
          +-----------+-----------+
          |                       |
       Model                   MCP Client
                                  |
                         +--------+--------+
                         |                 |
                    Memory MCP        Domain MCPs
                         |
                  Persistence/RAG
```

---

# 19. Implementación incluida

El repositorio incluye la implementación de Memory MCP como parte de Agent Runtime. Su objetivo es ser:

* fácil de instalar y configurar junto con Runtime
* responsable de conversaciones y mensajes
* persistente y multiusuario
* compatible con recuerdos, preferencias y recuperación de contexto
* independiente del proveedor de modelo

El usuario inicia Agent Runtime con el componente de memoria incluido; no necesita desarrollar ni proveer otro sistema de memoria.

---

# 20. Evolución del componente

Memory MCP puede evolucionar internamente —por ejemplo, ampliar la recuperación, los embeddings o la estrategia de persistencia— manteniendo un contrato estable con la API de Runtime.

El contrato compartido sirve para organizar esa integración interna y no define un punto de extensión para reemplazar Memory por Engram, Mem0, Zep u otro servicio externo.

---

# 21. Principio fundamental

> **Memory MCP es el componente de memoria integrado de Agent Runtime, no un proveedor externo opcional.**

La separación por MCP permite que la API de Runtime use operaciones de memoria mediante una interfaz clara, mientras el componente incluido conserva la responsabilidad de persistencia y lógica de memoria.

---

# 22. Arquitectura

```text
                         AGENT RUNTIME
                  +-------------------------+
                  | API / Agent Loop        |
                  |       |                 |
                  |       +-- MCP interno --+
                  |              |          |
                  |        Memory MCP       |
                  |              |          |
                  |          Storage        |
                  +-------------------------+
                         |           |
                    Model Provider  Domain MCPs
```

El Runtime ejecuta el agente y orquesta sus turnos.

El Memory MCP integrado administra conversaciones, mensajes y recuerdos.

Los proveedores de modelo suministran inferencia y los MCP configurados aportan capacidades externas de dominio.

Memory es una parte de la arquitectura de Agent Runtime; no se considera un componente externo intercambiable.
