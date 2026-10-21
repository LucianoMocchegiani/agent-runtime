# Conversaciones y contexto

## Responsabilidad de Runtime

Las conversaciones persistentes forman parte de Agent Runtime. Runtime administra el ciclo de vida de cada conversación y conserva el historial de mensajes que sirve como contexto para los turnos del agente.

```text
Agent Runtime
  ├── Perfiles y ejecución del agente
  ├── Conversaciones e historial de mensajes
  ├── Preferencias acotadas del usuario
  └── MCP Client ── MCPs externos configurados

PostgreSQL persiste los datos de la aplicación.
```

## Conversaciones

Una conversación es el hilo persistente de interacción. Runtime es responsable de:

- crear y listar conversaciones;
- actualizar sus metadatos, archivarlas y restaurarlas;
- persistir mensajes y recuperar el historial;
- asociar el perfil que se utilizará en los turnos siguientes;
- usar el contexto de la conversación al ejecutar cada turno.

El turno del agente es temporal: se inicia a partir de una petición, consulta la conversación y su perfil, ejecuta el loop y termina. No hay un proceso permanente reservado para cada conversación ni se reanuda automáticamente una ejecución interrumpida.

```text
Conversación persistida
        │
        ├── Mensajes anteriores
        ├── Perfil asignado
        └── Nuevo turno temporal
               ├── contexto del historial
               ├── llamadas al modelo y a MCPs
               └── respuesta y mensajes persistidos
```

## Contexto y capacidades opcionales

El historial de una conversación y los resúmenes asociados pueden ayudar a preparar el contexto de un turno. Esto no implica que Agent Runtime implemente un sistema general de memoria episódica, semántica, vectorial o de recuperación autónoma.

Si una aplicación necesita conocimiento persistente de dominio o una memoria avanzada, puede ofrecer esa capacidad mediante un MCP externo y configurarlo como cualquier otra integración. Su contenido, políticas, almacenamiento y recuperación quedan bajo responsabilidad de ese MCP; Runtime conserva la conversación y coordina la ejecución.

```text
Agent Runtime
   ├── Conversación e historial propios
   ├── MCP de dominio (opcional)
   └── MCP de memoria (opcional, externo)
```

