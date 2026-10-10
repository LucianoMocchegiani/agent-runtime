# Qué es Agent Runtime

Agent Runtime ejecuta agentes de IA con perfiles configurables, conversaciones persistentes y herramientas MCP externas.

Incluye un módulo interno **Memory** que administra conversaciones, mensajes, recuerdos, resúmenes y preferencias. Memory conserva sus modelos y migraciones, pero se ejecuta dentro del mismo proceso Runtime; no levanta un servidor, puerto ni MCP interno.

La aplicación persiste en PostgreSQL. Runtime es responsable de los perfiles y de aplicar el perfil asignado a cada conversación al comenzar cada turno. Los turnos son ejecuciones temporales y supervisables desde sus conversaciones, no procesos permanentes por hilo.
