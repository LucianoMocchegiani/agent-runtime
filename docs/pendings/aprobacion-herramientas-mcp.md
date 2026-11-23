# Pendientes para una versión futura: aprobación de herramientas MCP

## Situación actual

Agent Runtime puede pedir confirmación antes de ejecutar una herramienta MCP cuando se cumplen ambas condiciones:

- El perfil tiene `config.chat.confirmUserOnlyTools` activado (por defecto, `true`).
- El servidor MCP devuelve la herramienta con `_meta["chat/userOnly"] === true`.

La aprobación se aplica a chats interactivos normales, no a delegaciones. En los MCP de GymBro, por ejemplo, `confirm_proposal` usa esta marca. No es necesario que el MCP pertenezca a GymBro: cualquier servidor MCP que exponga la misma metadata puede usar el flujo.

El límite es que Runtime no ofrece actualmente una configuración para seleccionar herramientas individuales. Si un MCP externo no devuelve esa metadata, Runtime no pide aprobación para sus herramientas, aunque el perfil tenga `confirmUserOnlyTools` activado.

## Pendientes para otra versión

1. Permitir configurar en Runtime qué herramientas requieren aprobación, identificándolas por servidor MCP y nombre de herramienta, sin depender de metadata propia del servidor.
2. Exponer esa selección en la interfaz de configuración, con las herramientas disponibles para cada MCP y una opción clara para requerir o no aprobación.
3. Definir y documentar la prioridad entre la configuración explícita de Runtime y `_meta["chat/userOnly"]`, incluyendo el comportamiento cuando el nombre de herramienta cambia o el servidor no está disponible.
4. Añadir pruebas para selección por servidor/herramienta, herramientas que desaparecen o cambian de nombre, y la compatibilidad con herramientas marcadas por metadata.
5. Evaluar la reanudación automática del turno del modelo después de confirmar y ejecutar una herramienta. En la implementación actual, el resultado queda guardado en el historial, pero el modelo no continúa automáticamente para redactar una respuesta.
6. Implementar una UI nativa de confirmación en el chat para aprobar o rechazar la ejecución de herramientas que requieran aprobación.

Estos puntos son trabajo futuro; no están incluidos en el flujo actual de aprobación.
