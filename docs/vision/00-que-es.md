# Qué es Agent Runtime

Agent Runtime es un entorno de ejecución para agentes de IA que se integra con aplicaciones y herramientas externas mediante MCP.

## Cómo funciona hoy

Agent Runtime incluye su propio componente **Memory MCP**, que administra conversaciones, mensajes, recuerdos y preferencias. La API de Runtime lo consume mediante un contrato MCP interno. Aunque Memory se ejecuta como un proceso separado, forma parte de la solución y no se plantea como un servicio externo reemplazable.

Los MCP configurados para herramientas e integraciones de producto son capacidades externas que el agente puede utilizar durante sus turnos. Memory no es una de esas integraciones opcionales: es parte de la infraestructura del Runtime.

## Dirección del proyecto

El Runtime puede reutilizarse con distintas aplicaciones mediante configuración de identidad e integraciones MCP. La persistencia y el contrato de Memory siguen siendo responsabilidad de Agent Runtime; no se requiere que cada aplicación provea su propio MCP de memoria.
