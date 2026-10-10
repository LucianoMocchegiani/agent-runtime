# agent-runtime — documentación interna

Setup y env: [`../README.md`](../README.md).

## Visión — qué queremos que sea

| Documento | Contenido |
|-----------|-----------|
| [vision/00-que-es.md](./vision/00-que-es.md) | Qué es agent-runtime y hacia dónde va |
| [vision/01-mcp-genericos.md](./vision/01-mcp-genericos.md) | Runtime genérico conectado a cualquier app por MCP |
| [vision/02-providers-y-modelos.md](./vision/02-providers-y-modelos.md) | Abstracción de proveedores y modelos |
| [vision/03-memory-mcp.md](./vision/03-memory-mcp.md) | Memory MCP como componente integrado de Agent Runtime |

## Implementación — cómo está hecho hoy

| Documento | Contenido |
|-----------|-----------|
| [01-diseno-y-modelo.md](./01-diseno-y-modelo.md) | Rol, límites, stack, persistencia, aislamiento |
| [02-modulos.md](./02-modulos.md) | Qué hace cada carpeta de `apps/api/src/` y `packages/memory/src/` |
| [03-flujos.md](./03-flujos.md) | De abrir el chat a la respuesta; turno identificado; público; abort; errores |
| [04-http.md](./04-http.md) | Rutas, auth, códigos |
| [agent-profiles.md](./agent-profiles.md) | Perfiles reutilizables, perfil predeterminado y migración |
| [arquitectura.md](./arquitectura.md) | Concurrencia, limitaciones, estructura del código |

La visión puede ir adelante del código; en la implementación, si el código y el texto divergen, gana el código.

Idioma: español.
