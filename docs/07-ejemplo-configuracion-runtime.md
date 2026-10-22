# Ejemplo de configuración de Runtime

Los bloques de esta guía corresponden a pestañas distintas de Administración; no se combinan en un único objeto. Reemplazá los marcadores de API key y autorización por los valores reales. No guardes `********` literalmente ni publiques secretos.

## Perfil

En el perfil, el modelo de chat se selecciona en `model.chat`. El prompt compartido va en `config.systemPrompt` y los parámetros propios del chat, en `config.chat`.

```json
{
  "name": "desarrollo-de-software-basico",
  "model": {
    "chat": "openai/gpt-6-luna"
  },
  "config": {
    "systemPrompt": "Sos un asistente de IA. Usá las tools disponibles para responder. Si no sabés, decilo.",
    "chat": {
      "maxToolSteps": 150,
      "maxOutputTokens": 4096,
      "llmTraceRequests": false,
      "summariesEnabled": true,
      "contextTokenBudget": 10000,
      "maxContextMessages": 40,
      "summaryTokenBudget": 300,
      "contextSafetyTokens": 512,
      "reserveOutputTokens": 4096
    }
  }
}
```

## Provider

Los catálogos se agrupan por modalidad. `baseUrl` y la clave API pertenecen al proveedor; el proveedor debe declarar los modelos de embeddings que luego se puedan seleccionar en la pestaña Embedding.

```json
{
  "providers": {
    "openrouter": {
      "apiKey": "PEGAR_CLAVE_API_OPENROUTER",
      "models": {
        "chat": [
          "openai/gpt-4.1-mini",
          "anthropic/claude-sonnet-4",
          "google/gemini-2.5-flash"
        ]
      }
    },
    "openai": {
      "apiKey": "PEGAR_CLAVE_API_OPENAI",
      "baseUrl": "https://api.openai.com/v1",
      "models": {
        "chat": [
          "gpt-4.1-mini",
          "gpt-4.1",
          "gpt-6-luna"
        ],
        "embeddings": [
          "text-embedding-3-small"
        ],
        "realtime": [
          "gpt-realtime-2.1-mini"
        ]
      },
      "realtime": {
        "voices": [
          "alloy",
          "echo",
          "fable",
          "onyx",
          "nova",
          "shimmer"
        ]
      }
    }
  }
}
```

## Embedding

En esta pestaña se elige únicamente el identificador completo `proveedor/modelo`. La clave y la URL base se resuelven desde Provider.

```json
{
  "model": "openai/text-embedding-3-small"
}
```

## MCP

La configuración de servidores MCP se guarda bajo `mcpConfig`. Sustituí la URL y el marcador de autorización por los valores de tu servidor.

```json
{
  "mcpConfig": {
    "workspace": {
      "url": "https://workspace-mcp.lucianomocchegiani.xyz/mcp",
      "auth": null,
      "headers": {
        "Authorization": "PEGAR_VALOR_DE_AUTORIZACION"
      },
      "optional": true
    }
  }
}
```
