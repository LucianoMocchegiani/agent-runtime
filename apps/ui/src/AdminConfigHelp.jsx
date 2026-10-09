const guides = {
  Chat: {
    intro: 'Los enteros deben ser positivos. Estos ajustes controlan el contexto y la ejecución de cada turno.',
    fields: [
      ['chatSystemPrompt', 'Instrucción base que recibe el modelo en cada conversación. Definí el comportamiento general; no incluyas claves ni secretos.'],
      ['contextTokenBudget', 'Ventana de contexto en tokens usada como fallback para modelos sin contextWindows. Consultá la documentación del modelo y no superes su límite.'],
      ['maxContextMessages', 'Máximo de mensajes anteriores de usuario/asistente incluidos al iniciar el turno; no cuenta system ni tools. Aumentarlo conserva más historial y usa más contexto.'],
      ['responseTokenReserve', 'Tokens reservados para generar la respuesta; se descuentan del espacio para historial. Aumentalo si necesitás respuestas más largas.'],
      ['contextSafetyTokens', 'Margen para evitar exceder el contexto por variaciones de tokenización. Aumentalo si aparecen errores de contexto excedido.'],
      ['maxToolSteps', 'Máximo de rondas de uso de herramientas por turno. Más rondas pueden aumentar costo y latencia.'],
      ['llmTraceRequests', 'Registra solicitudes detalladas al proveedor; pueden incluir prompts, mensajes y resultados de herramientas con datos privados. Activá solo para depurar y luego desactivá.'],
      ['summariesEnabled', 'Activa resúmenes persistentes cuando mensajes antiguos quedan fuera del contexto. Desactivado, no se crean resúmenes nuevos.'],
      ['summaryTokenBudget', 'Presupuesto en tokens del resumen persistente. Más tokens conservan más detalles y consumen más contexto.'],
    ],
  },
  Providers: {
    intro: 'Se admiten openai y openrouter. Los secretos se enmascaran: dejá ******** sin modificar para conservar la clave guardada.',
    fields: [
      ['ai.defaultModel', 'Modelo predeterminado, formato proveedor/modelo. Debe existir en la lista models del proveedor. Ejemplos: openai/gpt-4.1-mini y openrouter/anthropic/claude-sonnet-4.'],
      ['ai.providers.<proveedor>.apiKey', 'Clave privada. Creala en OpenAI: https://platform.openai.com/api-keys o OpenRouter: https://openrouter.ai/keys. La cuenta debe tener acceso/crédito. No la compartas ni la pegues en documentación pública.'],
      ['ai.providers.<proveedor>.models', 'IDs de modelos que se ofrecen en el selector. Consultá https://platform.openai.com/docs/models o https://openrouter.ai/models. OpenAI usa ID sin prefijo; OpenRouter usa el slug completo, por ejemplo openai/gpt-4.1-mini.'],
      ['ai.providers.<proveedor>.contextWindows', 'Mapa opcional de ID exacto de modelo a ventana en tokens. Consultá la documentación/ficha del modelo; si no conocés el valor, dejá {} y se usará contextTokenBudget de Chat. Cada valor debe ser entero positivo.'],
    ],
    example: '{\n  "defaultModel": "openai/gpt-4.1-mini",\n  "providers": {\n    "openai": {\n      "apiKey": "PEGAR_CLAVE_API",\n      "models": ["gpt-4.1-mini"],\n      "contextWindows": {}\n    }\n  }\n}',
    note: 'Disponibilidad, permisos y precios dependen del proveedor y la cuenta. Verificá antes de seleccionar un modelo.',
  },
  Embeddings: {
    intro: 'Convierte documentos en vectores para búsqueda semántica. La base actual requiere vectores de exactamente 1536 dimensiones.',
    fields: [
      ['embeddingConfig.apiKey', 'Clave API de un proveedor compatible con embeddings OpenAI. Para OpenAI, creala en https://platform.openai.com/api-keys. Usá ******** para conservar la actual.'],
      ['embeddingConfig.baseUrl', 'URL base de la API, sin credenciales. OpenAI: https://api.openai.com/v1. Para otro proveedor, copiá la URL de su documentación y confirmá que soporte la API de embeddings compatible.'],
      ['embeddingConfig.model', 'ID exacto del modelo de embeddings. OpenAI text-embedding-3-small produce 1536 dimensiones; verificá que cualquier otro modelo también produzca exactamente 1536.'],
    ],
    example: '{\n  "apiKey": "PEGAR_CLAVE_API",\n  "baseUrl": "https://api.openai.com/v1",\n  "model": "text-embedding-3-small"\n}',
    note: 'Para desactivar, reemplazá el contenido por null. Cambiar modelo o endpoint vuelve a encolar documentos para reindexarlos y puede generar consumo/costo.',
  },
  MCP: {
    intro: 'Cada propiedad agrega un servidor MCP. El nombre admite letras, números, guion y guion bajo; las tools quedan como nombre__tool. La URL debe ser accesible desde agent-runtime.',
    fields: [
      ['<nombre>.url', 'Pedí al administrador del MCP la URL HTTP(S) de su endpoint. Docker Desktop y un MCP en tu PC: http://host.docker.internal:PUERTO/mcp. En Compose, usá el nombre del servicio y su puerto interno.'],
      ['<nombre>.auth', 'null no reenvía el token de usuario. Un string no vacío reenvía el Bearer de la sesión al MCP, por ejemplo "forward-user-token"; no es la URL ni un secreto.'],
      ['<nombre>.headers', 'Headers fijos enviados desde el servidor, como Authorization con un token/API key; pedí el nombre y formato al administrador del MCP. Se enmascaran: ******** conserva el valor. Si auth está activo, el Bearer del usuario reemplaza Authorization.'],
      ['<nombre>.optional', 'true deja continuar el turno si el MCP no conecta; false hace fallar el turno. Usá true si el servidor es auxiliar.'],
    ],
    example: '{\n  "mi_mcp": {\n    "url": "http://host.docker.internal:3020/mcp",\n    "auth": null,\n    "headers": {},\n    "optional": true\n  }\n}',
    note: 'Todavía no hay prueba de conexión desde la UI. Después de guardar, revisá logs y probá una conversación. No incluyas tokens reales en capturas.',
  },
};

function linkedText(text) {
  return text.split(/(https:\/\/[^\s]+)/g).map((part, index) => {
    if (!part.startsWith('https://')) return part;
    const url = part.replace(/[.,;:]$/, '');
    return <span key={index}><a href={url} target="_blank" rel="noreferrer">{url}</a>{part.slice(url.length)}</span>;
  });
}

export default function AdminConfigHelp({ tab }) {
  const guide = guides[tab];
  return <aside className="admin-guide" aria-label={`Ayuda de configuración: ${tab}`}>
    <h3>Guía de esta pestaña</h3>
    <p>{guide.intro}</p>
    <dl>{guide.fields.map(([name, description]) => <div className="admin-guide-field" key={name}>
      <dt><code>{name}</code></dt><dd>{linkedText(description)}</dd>
    </div>)}</dl>
    {guide.example && <><h4>Ejemplo de estructura</h4><pre className="admin-example"><code>{guide.example}</code></pre></>}
    {guide.note && <p className="admin-guide-note">{guide.note}</p>}
  </aside>;
}
