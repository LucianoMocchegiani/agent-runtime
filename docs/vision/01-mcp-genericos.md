# Agent Runtime

> **Un entorno de ejecución genérico para agentes de IA, capaz de conectarse con cualquier aplicación mediante MCP.**

## 1. Idea general

**Agent Runtime** es un runtime genérico para ejecutar agentes de IA sin acoplarlos a una aplicación, dominio, base de datos o sistema de memoria específico.

El objetivo es que una aplicación que quiera incorporar capacidades de IA **no tenga que implementar su propio agente, integrar directamente un LLM, manejar el agent loop, implementar memoria, RAG u orquestación**.

La aplicación solamente debe exponer sus capacidades mediante **MCP**.

El Agent Runtime se encarga de ejecutar el agente y conectarse con uno o varios MCP.

```text
                         AGENT RUNTIME
                              |
                         MCP Client
                              |
              +---------------+---------------+
              |               |               |
              v               v               v
          Application       Memory          Tools
             MCP              MCP             MCP
              |                |               |
              v                v               v
           Domain          Memory DB        External
           System          / RAG            Systems
```

---

# 2. Principio fundamental

El runtime **no debe conocer el dominio de la aplicación**.

No debería saber si está conectado a:

* un gimnasio;
* un CRM;
* GitHub;
* una tienda;
* una API;
* una computadora;
* un navegador;
* un sistema empresarial;
* otro agente;
* o cualquier otro sistema.

Para el runtime, todos son simplemente **MCPs que exponen capacidades**.

```text
Agent Runtime
      |
      +-- MCP A
      +-- MCP B
      +-- MCP C
      +-- MCP D
      +-- MCP N
```

Esto permite que el mismo runtime pueda reutilizarse en aplicaciones completamente diferentes.

---

# 3. El Agent Runtime

El Agent Runtime es responsable de la **ejecución del agente**, no de la lógica de negocio.

Entre sus responsabilidades se encuentran:

* ejecutar el agent loop;
* comunicarse con el modelo de IA;
* gestionar el contexto de ejecución;
* descubrir y consumir MCPs;
* ejecutar tools;
* procesar resultados;
* coordinar múltiples MCPs;
* manejar el ciclo de vida de una ejecución;
* gestionar identidad/contexto de ejecución;
* abstraer el proveedor de modelos.

Conceptualmente:

```text
Request
   |
   v
Agent Runtime
   |
   +-- Load context
   |
   +-- Call LLM
   |
   +-- Discover/use MCPs
   |
   +-- Execute tools
   |
   +-- Process results
   |
   +-- Continue agent loop
   |
   v
Response
```

El runtime debe intentar mantenerse **lo más stateless y agnóstico posible**.

---

# 4. MCP como frontera entre el agente y el mundo

MCP es la principal frontera de integración.

Una aplicación no necesita conocer cómo funciona internamente el Agent Runtime.

Solo necesita exponer un MCP.

```text
Application
     |
     | MCP
     v
Agent Runtime
```

Esto permite invertir la integración tradicional.

En lugar de:

```text
Application
    |
    +-- OpenAI integration
    +-- Agent logic
    +-- Memory
    +-- RAG
    +-- Tool orchestration
```

la aplicación puede hacer:

```text
Application
    |
    +-- Domain MCP
```

Y el Agent Runtime se encarga del resto.

---

# 5. Múltiples dominios

El runtime puede conectarse simultáneamente a múltiples MCPs.

Por ejemplo:

```text
                         Agent Runtime
                              |
             +----------------+----------------+
             |                |                |
             v                v                v
          Gym MCP         GitHub MCP         PC MCP
             |                |                |
          Gym API          GitHub API       Local OS
```

Esto permite que un agente combine información y capacidades de diferentes dominios.

Ejemplo:

> "Buscá los clientes con deuda, generá un reporte y guardalo en mi computadora."

El agente podría:

1. consultar el Gym MCP;
2. obtener la información;
3. generar el reporte;
4. utilizar el PC MCP;
5. guardar el archivo;
6. registrar la ejecución en un Memory MCP.

El Agent Runtime no necesita saber cómo funciona ninguno de esos dominios.

---
# 6. MCP como dominio o conjunto de capacidades

Un MCP no tiene por qué representar únicamente una "herramienta" aislada.

Un MCP puede representar un **dominio completo** y exponer todas las capacidades necesarias para interactuar con ese dominio.

Por ejemplo:

```text
Gym MCP
├── Tools
│   ├── getMember()
│   ├── createMembership()
│   ├── cancelMembership()
│   ├── registerPayment()
│   └── searchMembers()
│
├── Resources
│   └── información del gimnasio
│
├── Domain Logic
│
├── Authorization
│
├── RAG
│
└── Gym Database / API
```

De la misma forma, otros dominios pueden exponer sus propias herramientas:

```text
GitHub MCP
├── getRepository()
├── createIssue()
├── createBranch()
├── createPullRequest()
└── searchCode()
```

```text
PC MCP
├── readFile()
├── writeFile()
├── executeCommand()
└── listDirectory()
```

Por lo tanto, **Tools no es necesariamente una categoría separada de MCP**.

Las tools son capacidades que un MCP puede exponer.

El Agent Runtime no necesita saber si una tool pertenece a un dominio de negocio, a una computadora, a un servicio externo o a cualquier otro sistema.

---

# 7. Múltiples dominios

El Agent Runtime puede conectarse simultáneamente a múltiples MCPs.

Por ejemplo:

```text
                         Agent Runtime
                              |
             +----------------+----------------+
             |                |                |
             v                v                v
          Gym MCP         GitHub MCP         PC MCP
             |                |                |
           Tools            Tools            Tools
             |                |                |
             v                v                v
          Gym API          GitHub API       Local OS
```

Cada MCP puede tener una estructura completamente diferente.

Un dominio puede tener:

* tools;
* resources;
* prompts;
* lógica de negocio;
* autorización;
* RAG;
* acceso a bases de datos;
* acceso a APIs;
* memoria;
* un Harness propio;
* cualquier otra infraestructura necesaria.

El Agent Runtime solamente consume las capacidades que el MCP expone.

---

# 8. Composición de dominios

Una de las características principales del Agent Runtime es la posibilidad de **combinar múltiples dominios dentro de una misma ejecución**.

Por ejemplo, un agente podría recibir:

> "Buscá los clientes que tienen deuda, generá un reporte y guardalo en mi computadora."

El agente podría utilizar:

```text
1. Gym MCP
   └── getMembersWithDebt()

2. PC MCP
   └── writeFile()

3. Memory MCP
   └── saveContext()
```

El resultado sería:

```text
                         Agent Runtime
                              |
             +----------------+----------------+
             |                |                |
             v                v                v
          Gym MCP         PC MCP          Memory MCP
             |                |                |
          Gym DB             OS             Memory DB
```

El Runtime puede combinar estas capacidades sin conocer internamente cómo funciona ninguno de los dominios.

---

# 9. No existe un MCP "Tools" obligatorio

No es necesario imponer una arquitectura como:

```text
Memory MCP
Tools MCP
Product MCP
```

En su lugar, la composición puede ser completamente flexible:

```text
Agent Runtime
     |
     +-- Gym MCP
     +-- GitHub MCP
     +-- PC MCP
     +-- Browser MCP
     +-- Memory MCP
     +-- CRM MCP
     +-- cualquier otro MCP
```

Un MCP puede ser un dominio de negocio.

Otro puede representar una herramienta general.

Otro puede representar memoria.

Otro puede representar un dispositivo.

Todos son tratados por el Agent Runtime mediante la misma abstracción: **MCP**.

---

# 10. Principio de composición

La arquitectura sigue el principio:

> **El Agent Runtime ejecuta al agente. Los MCPs proporcionan las capacidades con las que el agente interactúa.**

Cada MCP es responsable de su propio dominio y puede decidir internamente cómo implementar sus capacidades.

```text
Agent Runtime
      |
      +------------------- MCP -------------------+
      |                                            |
      v                                            v
   Capability                                  Domain
      |                                            |
   Tool/Resource                         Logic / API / DB / RAG
```

Esto permite que el Agent Runtime permanezca completamente desacoplado de la organización interna de los sistemas externos.


# 11. Identidad

El Agent Runtime tampoco debería asumir cómo una aplicación identifica a sus usuarios.

Una aplicación puede utilizar:

```text
tenantId + userId
```

otra:

```text
organizationId + memberId
```

otra:

```text
walletAddress
```

otra:

```text
sub
```

El MCP del dominio es responsable de interpretar la identidad que recibe.

Por ejemplo:

```text
Bearer Token
     |
     v
Agent Runtime
     |
     | identity/context
     v
Domain MCP
     |
     v
Domain-specific identity
```

Esto permite que cada aplicación mantenga su propio modelo de identidad.

---

# 12. Seguridad y autorización

El Agent Runtime no debería convertirse en la autoridad de negocio de cada aplicación.

El MCP que controla un dominio debe poder aplicar sus propias reglas de autorización.

Por ejemplo:

```text
Agent Runtime
      |
      | authenticated context
      v
Gym MCP
      |
      +-- Is user allowed?
      +-- Which tenant?
      +-- Which resources?
      +-- Which operations?
      |
      v
Gym API / DB
```

De esta manera, la seguridad del dominio permanece junto al dominio.

El runtime proporciona el contexto necesario para que el MCP pueda tomar esas decisiones.

---

# 13. Desacoplamiento

El objetivo final es separar completamente:

```text
Agent Runtime
        |
        +-- Agent execution
        +-- LLM
        +-- MCP client
        +-- Orchestration
```

de:

```text
Domain
        |
        +-- Business logic
        +-- Database
        +-- APIs
        +-- Authorization
        +-- RAG
        +-- Harness
```

y de:

```text
Memory
        |
        +-- Sessions
        +-- Conversations
        +-- Context
        +-- Long-term memory
        +-- Retrieval
```

Todos estos componentes se comunican mediante MCP.

---

# 14. Arquitectura completa

La arquitectura objetivo puede representarse así:

```text
                              AGENT RUNTIME
                                   |
             +---------------------+---------------------+
             |                     |                     |
             v                     v                     v
           LLM                 MCP CLIENT            Execution
                                   |
             +---------------------+-----------------------+
             |                     |                       |
             v                     v                       v
        Memory MCP             Domain MCP             Tools MCP
             |                     |                       |
             |                 +---+---+                   |
             |                 |       |                   |
             |              Harness   RAG                  |
             |                 |       |                   |
             |                 +---+---+                   |
             |                     |                       |
             v                     v                       v
       Memory System          Domain System          External System
```

---

# 15. Ejemplo completo

Una aplicación de gimnasio podría implementar:

```text
Gym MCP
   |
   +-- Harness
   |    +-- identity
   |    +-- permissions
   |    +-- business rules
   |    +-- RAG
   |
   +-- Tools
   |    +-- getMember
   |    +-- createMembership
   |    +-- getPayments
   |    +-- bookClass
   |
   +-- Gym API
   |
   +-- Gym Database
```

Y utilizar:

```text
Memory MCP
   |
   +-- sessions
   +-- conversations
   +-- user context
   +-- long-term memory
```

El runtime simplemente conecta ambos:

```text
                       Agent Runtime
                            |
                    +-------+-------+
                    |               |
                    v               v
                Memory MCP       Gym MCP
                                    |
                                  Harness
                                    |
                              Gym API / DB
```

No hay código específico de gimnasio dentro del Agent Runtime.

---

# 16. Uso personal / desarrollo

La misma arquitectura puede utilizarse sin una aplicación empresarial.

Por ejemplo:

```text
Agent Runtime
      |
      +-- Engram / Memory MCP
      |
      +-- Local Computer MCP
      |
      +-- GitHub MCP
      |
      +-- Browser MCP
```

Esto permite utilizar el mismo Agent Runtime como agente personal o como herramienta de desarrollo.

El runtime permanece exactamente igual.

Solo cambia la composición de MCPs.

---

# 17. Objetivo final

El objetivo de Agent Runtime es llegar a una arquitectura donde:

> **El runtime ejecuta al agente.**
>
> **Los MCPs proporcionan capacidades y acceso a dominios.**
>
> **Los Harnesses adaptan cada dominio al uso por agentes.**
>
> **Los MCPs de memoria proporcionan estado y contexto.**
>
> **Los dominios pueden implementar su propio RAG.**
>
> **El consumidor decide qué MCPs conectar y cómo combinarlos.**

De esta manera, el Agent Runtime no está diseñado para una aplicación concreta.

Está diseñado para ser reutilizado.

```text
                 ONE AGENT RUNTIME
                        |
       +----------------+----------------+
       |                |                |
       v                v                v
    App A             App B           Personal
       |                |                |
      MCP              MCP              MCPs
       |                |                |
     Domain           Domain           Tools
     Memory           Memory           Memory
     RAG              RAG              RAG
```

## Principio central

> **One Agent Runtime. Any MCP. Any Domain. Any Memory.**

El runtime proporciona la ejecución.

El ecosistema MCP proporciona el mundo con el que el agente puede interactuar.
