# agent-runtime — documentación interna

Setup y variables de entorno: [`../README.md`](../README.md). Esta documentación describe la visión y la implementación actual; si divergen, para la implementación prevalece el código.

## Visión

| Documento | Contenido |
|-----------|-----------|
| [vision/00-que-es.md](./vision/00-que-es.md) | Qué es agent-runtime y hacia dónde va |
| [vision/01-mcp-genericos.md](./vision/01-mcp-genericos.md) | Runtime genérico conectado a cualquier app por MCP |
| [vision/02-providers-y-modelos.md](./vision/02-providers-y-modelos.md) | Abstracción de proveedores y modelos |
| [vision/03-conversaciones-y-contexto.md](./vision/03-conversaciones-y-contexto.md) | Conversaciones, contexto y límites de las capacidades de memoria |

## Implementación

| Documento | Contenido |
|-----------|-----------|
| [01-diseno-y-modelo.md](./01-diseno-y-modelo.md) | Rol, límites, stack, persistencia y aislamiento |
| [02-modulos.md](./02-modulos.md) | Responsabilidades de los módulos de `apps/api/` |
| [03-flujos.md](./03-flujos.md) | Flujos de chat, turnos, abortos y errores |
| [04-http.md](./04-http.md) | Rutas, autenticación y códigos HTTP |
| [05-perfiles-de-agente.md](./05-perfiles-de-agente.md) | Perfiles reutilizables, perfil predeterminado y migración |
| [06-configuracion-runtime.md](./06-configuracion-runtime.md) | Configuración global, proveedores, embeddings y secretos |
| [07-ejemplo-configuracion-runtime.md](./07-ejemplo-configuracion-runtime.md) | Ejemplos de los valores de cada pestaña de configuración |
| [08-arquitectura.md](./08-arquitectura.md) | Concurrencia, persistencia, despliegue y límites actuales |

## Desarrollo

| Documento | Contenido |
|-----------|-----------|
| [09-guia-de-desarrollo.md](./09-guia-de-desarrollo.md) | Estructura del repositorio y convenciones para contribuir |

Idioma: español.
