## Model Providers y abstracción de modelos

Un Agent Runtime genérico no debería estar acoplado a un modelo o proveedor de modelos específico.

El Runtime debe consumir una **interfaz abstracta de modelos** que permita cambiar el proveedor sin modificar el núcleo del Runtime.

### Principio

El Runtime no debería pensar:

> "Estoy usando GPT."

Debería pensar:

> "Tengo acceso a un modelo que implementa la interfaz que necesito."

La arquitectura puede representarse así:

```text
                    AGENT RUNTIME
                         |
                  Model Interface
                         |
          +--------------+--------------+
          |              |              |
      OpenRouter       OpenAI        Ollama
          |              |              |
     +----+----+         |         Local Models
     |    |    |
    GPT Claude Gemini
```

### AI SDK como abstracción interna

El Runtime puede utilizar **Vercel AI SDK** como capa de abstracción para interactuar con los modelos.

AI SDK proporciona una interfaz común para operaciones como:

* generación de texto
* streaming
* tool calling
* structured output
* manejo de mensajes
* interacción con diferentes providers

Esto evita implementar desde cero un adapter específico para cada proveedor.

Conceptualmente:

```text
Agent Runtime
      |
      v
  AI SDK / Model Interface
      |
      +------------------+
      |                  |
      v                  v
 OpenRouter           OpenAI
      |
 +----+----------+----------+
 |               |          |
GPT            Claude     Gemini
```

### OpenRouter como provider inicial

Para la primera implementación, **OpenRouter puede utilizarse como provider principal**, ya que permite acceder a múltiples modelos mediante una única interfaz.

El Runtime puede comenzar utilizando:

```text
Agent Runtime
      |
      v
Model Interface
      |
      v
OpenRouter
      |
 +----+---------+---------+
 |              |         |
GPT           Claude    Gemini
```

Sin embargo, OpenRouter no debe convertirse en una dependencia arquitectónica del Runtime.

La arquitectura debe permitir reemplazarlo por otros providers:

```text
Agent Runtime
      |
      v
Model Interface
      |
 +----+---------+---------+----------+
 |              |         |          |
OpenRouter    OpenAI   Anthropic   Ollama
```

De esta manera, OpenRouter es una **implementación del Model Provider**, no parte del núcleo conceptual del Agent Runtime.

### Providers intercambiables

El Runtime debería poder trabajar con:

* OpenRouter
* OpenAI
* Anthropic
* Google/Gemini
* Ollama
* modelos locales
* Azure u otros gateways
* providers propios
* cualquier implementación compatible con la interfaz utilizada

El objetivo es que agregar un provider nuevo no requiera modificar el Agent Loop.

```text
                  AGENT RUNTIME
                       |
                  Agent Loop
                       |
                 Model Interface
                       |
       +---------------+---------------+
       |               |               |
  OpenRouter        Ollama          Custom
       |               |               |
    Cloud           Local          Provider
```

### Separación entre modelo, provider y Runtime

Es importante distinguir tres conceptos:

```text
MODEL
  |
  |  GPT / Claude / Gemini / Llama
  |
  v
MODEL PROVIDER
  |
  |  OpenAI / Anthropic / OpenRouter / Ollama
  |
  v
AGENT RUNTIME
  |
  |  ejecuta el agente
  |  mantiene el loop
  |  coordina herramientas
  |  consume MCPs
  |  administra el contexto de ejecución
```

Un modelo es el sistema de inferencia.

Un provider es la forma mediante la cual el Runtime accede a uno o varios modelos.

El Agent Runtime es quien ejecuta el proceso del agente.

Por lo tanto:

> **El modelo proporciona inteligencia de inferencia, el provider proporciona acceso al modelo y el Runtime proporciona la ejecución del agente.**

### No asumir qué existe detrás del provider

El Runtime no debería asumir qué implementación existe detrás de un provider.

Por ejemplo:

```text
Model Interface
      |
      +── OpenRouter
      |      ├── GPT
      |      ├── Claude
      |      └── Gemini
      |
      +── Ollama
      |      └── Llama
      |
      +── Custom Provider
             └── cualquier modelo
```

El Runtime solamente conoce la interfaz que puede utilizar.

Esto mantiene desacoplados:

```text
Agent Runtime
    ≠
Model Provider
    ≠
Model
```

### Objetivo arquitectónico

El objetivo final es que el Agent Runtime pueda funcionar con:

> **Any Model. Any Provider.**

Mientras que la misma filosofía se mantiene para el resto de la arquitectura:

```text
                 AGENT RUNTIME
                       |
        +--------------+--------------+
        |              |              |
      Models          MCPs         Execution
        |              |              |
     Providers       Domains       Agent Loop
        |
   Any Provider
```

El Runtime no debería depender de un modelo concreto ni de un proveedor concreto.

Su responsabilidad es ejecutar el agente; la selección y conexión con el modelo deben permanecer desacopladas.
