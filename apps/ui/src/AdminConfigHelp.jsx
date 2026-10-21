import styles from './AdminConfigHelp.module.css';

const guides = {
  Profiles: {
    intro: 'Un perfil reúne el modelo y los parámetros de comportamiento del agente. Cada conversación usa el perfil que tiene asignado; el predeterminado se utiliza solo al crear chats nuevos. El editor JSON requiere name, model y config con todos sus campos obligatorios; realtime es opcional. Las credenciales de proveedores, MCP y embeddings se configuran en sus pestañas globales.',
    fields: [
      ['name', 'Nombre visible del perfil para identificarlo en la administración.'],
      ['model.chat / model.realtime', 'Modelos seleccionados para chat y voz Realtime. Chat usa el ID completo del proveedor (por ejemplo openai/gpt-4.1-mini); realtime usa un ID habilitado en el catálogo OpenAI. model.realtime es necesario para habilitar config.realtime.'],
      ['config.systemPrompt', 'Instrucción base compartida por chat y Realtime. No incluyas secretos ni credenciales.'],
      ['config.chat.contextTokenBudget', 'Presupuesto de contexto de respaldo en tokens para modelos de chat sin una ventana declarada en Provider.'],
      ['config.chat.maxContextMessages', 'Máximo de mensajes anteriores de usuario/asistente que se incluyen al iniciar cada turno de chat.'],
      ['config.chat.maxOutputTokens / config.chat.reserveOutputTokens', 'Límite de generación y tokens reservados para la salida al seleccionar el historial del chat. Normalmente conviene que la reserva sea igual o mayor que el máximo.'],
      ['config.chat.contextSafetyTokens', 'Margen para variaciones de tokenización y evitar exceder la ventana del modelo de chat.'],
      ['config.chat.maxToolSteps', 'Máximo de rondas de uso de herramientas permitidas por turno de chat.'],
      ['config.chat.summariesEnabled / config.chat.summaryTokenBudget', 'Controlan la generación y el tamaño de los resúmenes persistentes del chat.'],
      ['config.realtime', 'Opcional. Si omitís esta propiedad, la voz queda deshabilitada. Permite configurar VAD server-side, el máximo de salida y cuánto historial (mensajes, tools y resumen) incluir. Los campos omitidos reciben defaults seguros.'],
      ['config.realtime.vad', 'Ajusta la detección server_vad: threshold (0–1), prefixPaddingMs (0–2000), silenceDurationMs (100–5000), createResponse e interruptResponse. Defaults: 0.5, 300 ms, 500 ms y ambos true.'],
      ['config.realtime.maxOutputTokens', 'Máximo de tokens generados por respuesta Realtime, entero entre 1 y 4096. Default 4096; incluye llamadas a herramientas.'],
      ['config.realtime.maxMessageCharacters / maxToolResultCharacters / maxSummaryCharacters', 'Límite de caracteres por mensaje de usuario/asistente, por resultado de herramienta y para el resumen previo. Defaults: 4000, 2000 y 4000. maxInstructionsCharacters sigue limitando todas las instrucciones en conjunto.'],
    ],
    example: '{\n  "name": "Predeterminado",\n  "model": {\n    "chat": "openai/gpt-4.1-mini",\n    "realtime": "gpt-realtime"\n  },\n  "config": {\n    "systemPrompt": "Sos un asistente útil y claro.",\n    "chat": {\n      "contextTokenBudget": 10000,\n      "maxContextMessages": 20,\n      "maxOutputTokens": 4096,\n      "reserveOutputTokens": 4096,\n      "contextSafetyTokens": 512,\n      "maxToolSteps": 8,\n      "llmTraceRequests": false,\n      "summariesEnabled": true,\n      "summaryTokenBudget": 300\n    },\n    "realtime": {\n      "voice": "alloy",\n      "maxContextMessages": 12,\n      "maxInstructionsCharacters": 24000,\n      "maxMessageCharacters": 4000,\n      "maxToolResultCharacters": 2000,\n      "maxSummaryCharacters": 4000,\n      "maxOutputTokens": 4096,\n      "vad": {\n        "threshold": 0.5,\n        "prefixPaddingMs": 300,\n        "silenceDurationMs": 500,\n        "createResponse": true,\n        "interruptResponse": true\n      }\n    }\n  }\n}',
    note: 'Editar un perfil afecta los próximos turnos de las conversaciones que lo tienen asignado. Para cambiar el perfil de una conversación existente, usá el selector de esa conversación; cambiar el predeterminado no la modifica. La voz solo está habilitada cuando model.realtime y config.realtime existen y coinciden con los catálogos de Provider.',
  },
  Chat: {
    intro: 'Los enteros deben ser positivos. Estos ajustes controlan el contexto y la ejecución de cada turno.',
    fields: [
      ['chatSystemPrompt', 'Instrucción base que recibe el modelo en cada conversación. Definí el comportamiento general; no incluyas claves ni secretos.'],
      ['contextTokenBudget', 'Presupuesto de contexto en tokens aplicado a todos los modelos de chat. Configuralo según la ventana admitida por el modelo más restrictivo que habilites.'],
      ['maxContextMessages', 'Máximo de mensajes anteriores de usuario/asistente incluidos al iniciar el turno; no cuenta system ni tools. Aumentarlo conserva más historial y usa más contexto.'],
      ['maxOutputTokens', 'Máximo de tokens que puede generar cada llamada al modelo. Es un techo, no una cantidad que deba consumirse; el modelo o proveedor puede imponer un máximo menor.'],
      ['reserveOutputTokens', 'Espacio que se aparta de la ventana del modelo para la salida al seleccionar el historial; debe ser mayor o igual que maxOutputTokens. La diferencia entre reserva y máximo queda fuera del historial, pero no aumenta lo que el modelo puede generar. Normalmente conviene que ambos valores sean iguales.'],
      ['contextSafetyTokens', 'Margen para evitar exceder el contexto por variaciones de tokenización. Aumentalo si aparecen errores de contexto excedido.'],
      ['maxToolSteps', 'Máximo de rondas de uso de herramientas por turno. Más rondas pueden aumentar costo y latencia.'],
      ['llmTraceRequests', 'Registra solicitudes detalladas al proveedor; pueden incluir prompts, mensajes y resultados de herramientas con datos privados. Activá solo para depurar y luego desactivá.'],
      ['summariesEnabled', 'Activa resúmenes persistentes cuando mensajes antiguos quedan fuera del contexto. Desactivado, no se crean resúmenes nuevos.'],
      ['summaryTokenBudget', 'Presupuesto en tokens del resumen persistente. Más tokens conservan más detalles y consumen más contexto.'],
    ],
  },
  Providers: {
    intro: 'Configurá las credenciales y los catálogos de modelos disponibles. Los modelos de chat se seleccionan en perfiles; Embeddings declara modelos disponibles y su pestaña elige uno. Se admiten openai y openrouter; los secretos se enmascaran: dejá ******** sin modificar para conservar la clave guardada.',
    fields: [
      ['ai.providers.<proveedor>.apiKey', 'Clave privada. Creala en OpenAI: https://platform.openai.com/api-keys o OpenRouter: https://openrouter.ai/keys. La cuenta debe tener acceso/crédito. No la compartas ni la pegues en documentación pública.'],
      ['ai.providers.<proveedor>.models.chat', 'IDs de modelos de chat que se ofrecen en el selector. Consultá https://platform.openai.com/docs/models o https://openrouter.ai/models. OpenAI usa ID sin prefijo; OpenRouter usa el slug completo, por ejemplo openai/gpt-4.1-mini.'],
      ['ai.providers.<proveedor>.models.embeddings', 'IDs de modelos de embeddings ofrecidos por este proveedor. La pestaña Embedding elige el modelo usando el ID completo proveedor/modelo; el proveedor aporta la clave y la URL base. Los vectores deben tener exactamente 1536 dimensiones.'],
      ['ai.providers.openai.baseUrl', 'URL base compartida por las solicitudes de chat del SDK y las sesiones Realtime. Por defecto: https://api.openai.com/v1. Si usás un proxy, confirmá que admita ambos endpoints; la conexión WebRTC del navegador también usa esta URL.'],
      ['ai.providers.openai.models.realtime', 'IDs de modelos disponibles para conversación hablada Realtime. Es un catálogo independiente de models.chat; no agregues aquí modelos de chat comunes.'],
      ['ai.providers.openai.realtime.voices', 'Voces habilitadas para la salida de audio Realtime. La transcripción de entrada no se configura ni se guarda.'],
    ],
    example: '{\n  "providers": {\n    "openai": {\n      "apiKey": "PEGAR_CLAVE_API",\n      "baseUrl": "https://api.openai.com/v1",\n      "models": {\n        "chat": ["gpt-4.1-mini"],\n        "embeddings": ["text-embedding-3-small"],\n        "realtime": ["gpt-realtime"]\n      },\n      "realtime": {\n        "voices": ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]\n      }\n    }\n  }\n}',
    note: 'Disponibilidad, permisos y precios dependen del proveedor y la cuenta. Verificá antes de seleccionar un modelo. OpenRouter admite sus catálogos models.chat y models.embeddings; su URL base es la predeterminada del servicio. OpenAI baseUrl se aplica al SDK de chat, Realtime y embeddings, por lo que un proxy debe admitir esas APIs. La voz usa Realtime WebRTC; Runtime mantiene las claves y procesa las tools autorizadas.',
  },
  Embeddings: {
    intro: 'Convierte documentos en vectores para búsqueda semántica. La clave y la URL se toman del proveedor configurado; la base actual requiere vectores de exactamente 1536 dimensiones.',
    fields: [
      ['model', 'Modelo activo en formato proveedor/modelo, que debe estar declarado en ai.providers.<proveedor>.models.embeddings. Por ejemplo, openai/text-embedding-3-small. OpenAI text-embedding-3-small produce 1536 dimensiones; verificá la dimensión de cualquier otro modelo.'],
    ],
    example: '{\n  "model": "openai/text-embedding-3-small"\n}',
    note: 'Para desactivar embeddings, dejá model vacío; al guardar se conserva como null. Cambiar de modelo vuelve a encolar documentos para reindexarlos y puede generar consumo/costo.',
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
  Auth: {
    intro: 'La introspección permite que Runtime consulte el sistema de autenticación del huésped para validar cada Bearer opaco y obtener la identidad de usuario. Se hace un GET al endpoint configurado con Authorization: Bearer <token>; Runtime no valida firmas JWT por sí mismo.',
    fields: [
      ['authIntrospectUrl', 'URL absoluta HTTP o HTTPS, accesible desde el proceso/contenedor de agent-runtime (por ejemplo http://host.docker.internal:3001/auth/me durante desarrollo). Dejala vacía o en null para desactivar la introspección. Se permiten HTTP y HTTPS; quien administra la instalación debe decidir si HTTP es apropiado para su red.'],
      ['authMapping.userId', 'Nombre de la propiedad en el JSON de respuesta que contiene el identificador de usuario; obligatorio y no vacío. Por ejemplo, si la respuesta es {"sub":"123"}, usá "sub".'],
      ['authMapping.email', 'Nombre de la propiedad que contiene el email, o null para no mapearlo. Un campo ausente o que no sea texto queda como null.'],
      ['authMapping.name', 'Nombre de la propiedad que contiene el nombre visible, o null para no mapearlo. Un campo ausente o que no sea texto queda como null.'],
    ],
    example: '{\n  "authIntrospectUrl": "http://host.docker.internal:3001/auth/me",\n  "authMapping": {\n    "userId": "userId",\n    "email": "email",\n    "name": "name"\n  }\n}',
    note: 'Comportamiento y errores: sin URL, todas las rutas /v1 siguen siendo públicas y reciben identidad anónima; un Bearer opaco no se valida. Sin token también se asigna identidad anónima aunque la introspección esté activa; anon:<uuid> conserva la misma sesión entre solicitudes. Esto afecta a toda la API, no solo a una ruta. El acceso de administración basado en RUNTIME_CONFIG_ADMIN_USERS también depende de la introspección; el token RUNTIME_CONFIG_ADMIN_TOKEN y el acceso bootstrap, cuando está habilitado, son vías independientes. Si el endpoint rechaza el token con HTTP 401/403, la API responde 401. Si no conecta, vence el timeout de 8 segundos, da otro error, devuelve JSON inválido o falta userId, responde 502. Una identidad ya comprobada puede seguir en caché hasta 30 segundos; al cambiar URL o mapeo se vacía la caché. Probar conexión requiere ingresar un Bearer real: la prueba usa el JSON actual del editor, no guarda el token ni la configuración, y muestra la identidad mapeada. Una URL que no funciona no impide guardar, pero los Bearer normales fallarán hasta corregirla o desactivar la introspección.',
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
  return <aside className={styles.guide} aria-label={`Ayuda de configuración: ${tab}`}>
    <h3>Guía de esta pestaña</h3>
    <p>{guide.intro}</p>
    <dl>{guide.fields.map(([name, description]) => <div className={styles.guideField} key={name}>
      <dt><code>{name}</code></dt><dd>{linkedText(description)}</dd>
    </div>)}</dl>
    {guide.example && <><h4>Ejemplo de estructura</h4><pre className={styles.example}><code>{guide.example}</code></pre></>}
    {guide.note && <p className={styles.guideNote}>{guide.note}</p>}
  </aside>;
}
