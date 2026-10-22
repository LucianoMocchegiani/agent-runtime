# Configuración de Runtime

`runtime.config` guarda configuración global de infraestructura en el schema PostgreSQL `runtime`. Los perfiles reutilizables se guardan en `runtime.agent_profile_configs`. Memory persiste conversaciones y mensajes en `public`; el módulo y Runtime comparten el mismo proceso y la misma base PostgreSQL, con ownership lógico separado.

## Autenticación del huésped

La URL de introspección y el mapeo de identidad (`userId`, `email`, `name`) se almacenan en `runtime.config`, cifrados con el resto de la configuración, y se editan desde Administración → Auth. Las variables de entorno de introspección no se usan. Se admiten URLs HTTP y HTTPS; la conectividad y la elección del transporte son responsabilidad de quien despliega.

Una URL vacía desactiva la introspección y deja todas las rutas `/v1` en modo público/anónimo. Las solicitudes sin Bearer siguen permitidas; los Bearer opacos se rechazan con HTTP 401 porque no pueden validarse, mientras que `anon:<uuid>` mantiene la identidad anónima entre solicitudes. Si se configura una URL que no responde, la API responde 502 en solicitudes con Bearer que requieren introspección, salvo resultados todavía vigentes en la caché (30 segundos). HTTP 401/403 del servicio externo se traduce a 401; timeout (8 segundos), otros errores, JSON inválido o ausencia de `userId` se traducen a 502. El acceso administrativo por allowlist también depende de que la introspección funcione. La pestaña incluye una prueba manual con un token temporal, no persistido. Ver [Identidad y autorización](./04-http.md#identidad-y-autorización).

## Embeddings

La selección de embeddings se guarda en `runtime.config` como `embeddingConfig: { "model": "proveedor/modelo" }`; desde Administración → Embedding solo se configura ese modelo. La clave API y la URL base se toman del proveedor seleccionado, y el modelo debe figurar en su catálogo `models.embeddings`. Runtime entrega las credenciales resueltas al módulo Memory sin exponerlas en la pestaña Embedding. La configuración anterior se migra automáticamente si sus credenciales y endpoint coinciden con un proveedor configurado; de lo contrario, hay que mover esa clave/URL a Provider antes de actualizar. El worker de indexación corre como tarea de fondo dentro del proceso de la API. No hay endpoint interno, token compartido ni llamada HTTP entre Memory y Runtime.

## Proveedores y modelos

Los proveedores se configuran desde Administración → Provider. `models.chat` contiene los modelos que pueden seleccionarse en perfiles; `models.embeddings` declara los modelos disponibles para la búsqueda semántica; los modelos de conversación hablada son un catálogo separado (`models.realtime`) y solo se admite actualmente para OpenAI. No hay un modelo de chat global en la configuración runtime: cada perfil selecciona el suyo. La pestaña Embedding selecciona un modelo con el ID completo `proveedor/modelo`; Runtime usa las credenciales y URL base de ese proveedor. Las ventanas de contexto no se mantienen por modelo: cada perfil aplica `contextTokenBudget` como límite de contexto.

En OpenAI, `baseUrl` está al nivel del proveedor y se comparte entre el SDK de chat y las llamadas Realtime del backend. También determina el endpoint Realtime al que se conecta el navegador; un proxy personalizado debe ser compatible con ambas APIs.

```json
{
  "providers": {
    "openai": {
      "apiKey": "PEGAR_CLAVE_API",
      "baseUrl": "https://api.openai.com/v1",
      "models": {
        "chat": ["gpt-4.1-mini"],
        "embeddings": ["text-embedding-3-small"],
        "realtime": ["gpt-realtime"]
      },
      "realtime": {
        "voices": ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
      }
    }
  }
}
```

OpenRouter admite `models.chat` y, si la API del modelo lo permite, `models.embeddings`; no se configura ahí `baseUrl` ni catálogo Realtime. `contextWindows` ya no forma parte de la configuración: si aparece en valores persistidos de versiones anteriores, Runtime lo elimina al normalizar la configuración.

## Perfiles

El modelo y el comportamiento del agente viven en perfiles de Runtime. Las conversaciones almacenan `agent_profile_id`, una referencia sin FK entre schemas. Runtime valida la referencia al asignar y carga el perfil en cada turno. Los hilos anteriores se asignan una sola vez al perfil activo predeterminado durante el startup, tras aplicar la migración de Memory.

Cambiar el perfil predeterminado no reasigna conversaciones existentes. Los perfiles archivados siguen resolviéndose para los hilos que ya los tienen asignados, aunque dejan de aparecer en selectores nuevos. Ver [Perfiles de agente](./05-perfiles-de-agente.md).

La voz se configura en dos niveles: `ai.providers.openai.models.realtime` y `ai.providers.openai.realtime.voices` declaran el catálogo habilitado; cada perfil selecciona su modelo en `model.realtime` y, opcionalmente, activa voz eligiendo una voz de salida con `config.realtime.voice`. `config.systemPrompt` se comparte entre modalidades, mientras `config.chat` y `config.realtime` contienen ajustes propios de cada modalidad. Los perfiles pueden ajustar los mensajes previos de contexto Realtime y el máximo total de caracteres de instrucciones. El modelo de chat se elige por separado en `model.chat`. El navegador conecta audio con WebRTC usando solo un secreto efímero emitido por Runtime. Runtime prepara las tools autorizadas (MCP, conversación, memoria y delegaciones) y ejecuta sus llamadas con la identidad autenticada; la clave permanente y las conexiones MCP no llegan al cliente. No se pide ni se guarda transcripción; tampoco se persiste audio. Ver [Perfiles de agente](./05-perfiles-de-agente.md#configuración-de-voz-por-perfil).

## Variables requeridas

`DATABASE_URL` y `RUNTIME_CONFIG_ENCRYPTION_KEY` son obligatorias. La clave de cifrado debe conservarse mientras haya settings guardados. Memory usa la misma base de datos sin requerir `MEMORY_MCP_URL`, `MEMORY_MCP_PORT` ni `RUNTIME_CONFIG_INTERNAL_TOKEN`.
