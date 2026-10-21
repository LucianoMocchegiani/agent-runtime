# Qué es Agent Runtime

Agent Runtime ejecuta agentes de IA con perfiles configurables, conversaciones persistentes y herramientas MCP externas.

Runtime administra las conversaciones y sus mensajes, y utiliza el historial como contexto de los turnos. La persistencia de conversaciones es parte del producto; no depende de un Memory MCP separado. Las preferencias del usuario son una capacidad acotada, no un sistema general de memoria a largo plazo.

La aplicación persiste en PostgreSQL. Runtime también es responsable de los perfiles y de aplicar el perfil asignado a cada conversación al comenzar cada turno. Los turnos son ejecuciones temporales y supervisables desde sus conversaciones, no procesos permanentes por hilo.
