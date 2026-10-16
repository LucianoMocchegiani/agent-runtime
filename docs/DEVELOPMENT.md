# Guía de desarrollo

Esta guía explica cómo ubicar cambios en el monorepo y qué convenciones seguir. Describe el código actual, no una arquitectura idealizada: si esta guía y la implementación divergen, prevalece el código y conviene actualizar la documentación cuando el cambio sea intencional.

Las convenciones son criterios por defecto, no reglas rígidas. Una feature puede necesitar otra distribución; en ese caso, buscá que la estructura deje clara su responsabilidad y evitá agregar capas sin una necesidad concreta.

## Estructura del repositorio

```text
apps/
├── api/                    # API HTTP, módulos de dominio y persistencia
│   ├── prisma/              # Schema y migraciones
│   └── src/
├── ui/                     # UI React/Vite servida por la API
packages/
└── client/                 # Cliente HTTP y de streaming

docs/                       # Documentación del producto y de la implementación
```

Es un monorepo npm workspaces. La API y la UI viven en `apps/`; el SDK compartido está en `packages/client`. Memory no es un workspace ni un servicio separado: su búsqueda y sus contratos internos forman parte de `apps/api`. MCP se utiliza para herramientas externas.

Cada módulo mantiene sus contratos junto a su dominio (`conversations/contracts.ts`, `messages/contracts.ts`, `preferences/contracts.ts` y `memory-search/contracts.ts`). El agente importa las operaciones de persistencia que necesita directamente; no hay una fachada `MemoryService` que vuelva a agrupar dominios. Prisma, schema y migraciones pertenecen al workspace `apps/api`.

### Módulos de la API

Los módulos de `apps/api/src` se organizan principalmente por dominio o responsabilidad:

```text
src/
├── agent/
│   ├── tools/              # Preparación e integración de herramientas del agente
│   ├── turn/               # Ejecución, contexto, persistencia y streaming de turnos
│   └── window/             # Ventanas de contexto
├── auth/                   # Identidad, introspección y middleware
├── conversations/          # Rutas, servicios, persistencia, IDs y cursores
├── db/                     # Cliente Prisma y preparación de PostgreSQL
├── delegations/            # Rutas, almacenamiento, payload y worker de delegaciones
├── http/                   # Utilidades HTTP reutilizables, como lectura de requests
├── llm/                    # Proveedores y rutas de modelos
├── memory-search/          # Búsqueda semántica e indexación
├── messages/               # Entrada HTTP y persistencia de mensajes
├── preferences/            # Rutas, cursor HTTP y persistencia de preferencias
├── pagination/             # Utilidades de paginación compartidas
├── runtime-config/         # Configuración y administración de perfiles
├── voice/                  # Rutas y flujo de voz
├── app.ts                  # Middleware, health y montaje de rutas
├── config.ts               # Configuración de entorno
└── index.ts                # Arranque del servidor
```

El árbol es orientativo: no hace falta que cada módulo tenga los mismos tipos de archivos. Para conocer las responsabilidades y los flujos, consultá también [Módulos](./02-modulos.md), [Flujos](./03-flujos.md), [HTTP](./04-http.md) y [Arquitectura](./arquitectura.md).

## Dónde ubicar un cambio

| Si agregás o modificás… | Empezá en… |
|---|---|
| Una ruta y el comportamiento HTTP de un dominio | El módulo de ese dominio, por ejemplo `conversations/`, `delegations/` o `runtime-config/` |
| Reglas o coordinación propias del agente | `agent/`, en el submódulo responsable (`turn/`, `tools/` o `window/`) |
| Un endpoint que recibe mensajes | `messages/`; mantené allí la entrada HTTP y delegá el trabajo del turno al módulo `agent/` cuando corresponda |
| La integración con conversaciones, mensajes o preferencias | El módulo de dominio correspondiente; la búsqueda transversal vive en `memory-search/` |
| Un tipo usado solo por un módulo | Cerca de ese módulo |
| Contrato de un dominio de la API | Junto al dominio que lo posee: `conversations/contracts.ts`, `messages/contracts.ts`, `preferences/contracts.ts` o `memory-search/contracts.ts` |
| Un comportamiento transversal de HTTP, autenticación o paginación | El módulo transversal existente (`http/`, `auth/`, `pagination/`); incorporá una abstracción solo si más de un consumidor la necesita |
| Una pantalla o interacción de la UI | `apps/ui/src/`; el acceso a la API debe usar `packages/client` cuando aplique |
| Cambios de schema o migraciones de persistencia | `apps/api/prisma/` |
| Documentación de una feature o una decisión | El documento de dominio existente o uno nuevo en `docs/`, enlazado desde `docs/00-indice.md` si corresponde |

## Convenciones para distribuir archivos

- **Organizá primero por dominio, después por tipo de archivo.** Evitá crear carpetas globales `routes/`, `services/` o `types/` que dispersen un mismo comportamiento entre ubicaciones alejadas.
- **Mantené juntas las piezas que evolucionan por la misma razón.** Una ruta, su servicio específico y sus pruebas pueden vivir dentro del módulo de la feature.
- **Separá responsabilidades cuando la separación aporte claridad o testabilidad.** Las rutas se ocupan del límite HTTP y de coordinar; las reglas de dominio y persistencia van en el módulo que las posee.
- **No agregues archivos por simetría.** Si una feature no necesita un servicio, adaptador o tipo propio, no lo crees solo porque otro módulo sí lo tiene.
- **Usá nombres que expresen dominio y propósito.** En módulos con una sola pieza de un tipo, los nombres simples existentes como `routes.ts` o `service.ts` son suficientes. Si hay varias piezas similares en el mismo directorio, agregá el contexto al nombre, como `agent-profile-routes.ts` o `runtime-config-routes.ts`.
- **Evitá cajones de sastre.** No agregues `utils.ts`, `helpers.ts` o `common.ts` para una función que tiene un dominio identificable. Un módulo compartido debe tener consumidores reales y una responsabilidad acotada.
- **Poné los tipos junto al dueño del contrato.** Mantené tipos privados en su módulo. Compartilos mediante el paquete apropiado cuando crucen límites de workspace o formen parte de una API compartida.
- **No dupliques lógica o contratos para evitar una dependencia razonable.** Si dos dominios comparten una regla, revisá si pertenece a uno de ellos o si justifica un módulo compartido explícito.

## Rutas y ensamblado HTTP

Las rutas se definen dentro del módulo responsable. `apps/api/src/app.ts` es el punto de ensamblado: registra middleware global, health, rutas administrativas, el grupo autenticado `/v1` y la UI. Al agregar un endpoint:

1. Implementá la ruta en el módulo dueño del comportamiento.
2. Aplicá autenticación/autorización en el límite apropiado; `/v1` se monta detrás del middleware de identidad.
3. Registrá el subrouter en `app.ts` si es necesario, conservando el prefijo y el límite de seguridad correctos.
4. Validá entradas HTTP en el límite y mantené consistentes el formato de respuesta y los códigos de error.
5. Actualizá `docs/04-http.md` cuando cambie una ruta o su contrato observable.

Las rutas administrativas y las rutas autenticadas `/v1` tienen montajes distintos. No cambies de grupo una ruta sin revisar sus requisitos de identidad, permisos y exposición.

## Pruebas

Ubicá las pruebas junto al módulo que verifican y usá nombres `*.test.ts` (API) o el patrón ya establecido por el paquete. Preferí comprobar comportamiento observable y límites importantes —validación, permisos, cursores, persistencia o errores— en lugar de acoplar las pruebas a detalles internos que pueden cambiar.

Si agregás una prueba, verificá que el script del workspace la descubra o incluya. El script raíz `npm test` ejecuta las pruebas configuradas por `apps/api`; el script de la UI se ejecuta aparte con `npm run test -w apps/ui`.

## Tipos, comentarios y documentación

- Mantené los tipos estrictos y aprovechá los tipos existentes de los límites entre módulos.
- Documentá con TSDoc las funciones o contratos exportados cuando su uso o comportamiento no resulte obvio.
- Escribí comentarios para explicar intención, restricciones o decisiones; evitá narrar línea por línea lo que el código ya expresa.
- Si cambia una decisión arquitectónica, un flujo o el contrato HTTP, actualizá el documento correspondiente y sus enlaces en el índice.

## Flujo recomendado para una feature

1. Identificá quién es dueño del comportamiento y buscá un módulo existente antes de crear otro.
2. Revisá los contratos, rutas y patrones de prueba cercanos.
3. Implementá el cambio en el módulo correspondiente; agregá una capa nueva solo si separa una responsabilidad real.
4. Añadí o actualizá pruebas y documentación de contratos cuando corresponda.
5. Ejecutá las validaciones desde la raíz del repositorio:

   ```sh
   npm test
   npm run typecheck
   npm run build
   ```

`npm run typecheck` verifica los workspaces indicados en su script; la UI es JavaScript y su validación de producción ocurre en `npm run build`. Si trabajaste específicamente en la UI, ejecutá también `npm run test -w apps/ui`.

## Comandos habituales

```sh
npm install
docker compose up -d postgres
npm run dev
```

`npm run dev` prepara los paquetes y la base e inicia API y UI. Para configuración de entorno, Compose y despliegue, seguí las instrucciones del [README](../README.md).
./README.md).
./README.md).
