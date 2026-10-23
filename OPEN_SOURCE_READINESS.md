# Pendientes para publicar como software open source

Este documento reúne los temas que todavía conviene resolver o verificar antes de presentar `agent-runtime` como un proyecto open source listo para uso público. Es una lista de trabajo, no una afirmación de que el proyecto ya esté listo ni una garantía de seguridad. Las decisiones que corresponden a quienes mantienen el proyecto están marcadas explícitamente; no se presupone ninguna elección.

## 1. Decisiones y requisitos para abrir el proyecto

- [ ] **Elegir y agregar una licencia.** Actualmente no se identificó un archivo de licencia en la raíz. Sin una licencia explícita, quienes encuentran el código no tienen permisos claros para reutilizarlo, modificarlo o redistribuirlo.
  - **Requiere decisión de los responsables:** elegir la licencia según los objetivos del proyecto y revisar sus implicancias legales y de dependencias. No asumir que una licencia permisiva o copyleft es la adecuada.
  - Una vez decidida, agregar el texto oficial como `LICENSE` (o el nombre que corresponda) y comprobar que los avisos de copyright y las licencias de dependencias sean compatibles.

- [ ] **Definir el alcance de la publicación y el soporte.** Aclarar qué componentes se consideran públicos y mantenidos (API, UI, SDK, módulo Memory, imágenes Docker), qué plataformas/versiones se soportan y bajo qué expectativas de estabilidad.
  - La versión inicial del proyecto se fijó en `0.1.0`. **Requiere decisión de los responsables:** política de compatibilidad, deprecaciones, soporte y canales oficiales de comunicación.
  - Reflejar las decisiones en el README y la documentación de contribución.

## 2. Contribuciones, seguridad y uso aceptable

- [ ] **Crear `CONTRIBUTING.md`.** No se identificó una guía de contribución. Sin ella, resulta difícil saber cómo preparar el entorno, ejecutar pruebas, proponer cambios o seguir convenciones del proyecto.
  - Documentar requisitos (incluida la versión de Node), instalación, configuración local de PostgreSQL, comandos de desarrollo, build, typecheck y tests; indicar cómo abrir issues y pull requests, formato esperado y criterios de revisión.
  - Enlazar la guía desde el README y, si corresponde, agregar plantillas de issues/PR con información útil para reproducir problemas.

- [ ] **Crear `SECURITY.md` y un canal privado para reportes.** No se identificó una política de divulgación de vulnerabilidades. Publicar detalles sensibles en un issue puede exponer a usuarios antes de que haya una corrección.
  - Definir versiones con soporte, cómo reportar vulnerabilidades de forma privada, qué información incluir, plazos o expectativas de respuesta y cómo se coordina una divulgación responsable.
  - **Requiere decisión de los responsables:** elegir y monitorear el canal de contacto (por ejemplo, una dirección o función de reporte privado del hosting).

- [ ] **Aclarar límites de autenticación y exposición.** `/admin` admite una cuenta local Basic de recuperación (`admin/admin` por defecto, configurable con `RUNTIME_ADMIN_USERNAME` y `RUNTIME_ADMIN_PASSWORD`) independiente del proveedor de identidad, además de Bearers verificados y registrados en PostgreSQL `runtime_admins`. El modo anónimo se basa en una identidad UUID persistida por el cliente y no equivale a autenticación fuerte multiusuario.
  - Antes de exponer una instalación, cambiar las credenciales locales predeterminadas, poner TLS delante, inicializar los administradores habituales mediante `npm run admin:bootstrap` con el ID verificado y la URL de introspección del entorno, usar secretos fuera del repositorio, restringir el acceso de red y revisar CORS.
  - Documentar explícitamente qué mecanismo protege cada endpoint, cómo se identifica al usuario y cuáles son las limitaciones del modo anónimo. No presentar ese modo como adecuado para despliegues públicos multiusuario sin una evaluación específica.
  - Revisar además el manejo de secretos, TLS/proxy, permisos de base de datos, copias de seguridad y rotación/recuperación de claves de cifrado.

## 3. Dependencias y cadena de suministro

- [ ] **Resolver el hallazgo de auditoría de dependencias.** En la revisión anterior, `npm audit --omit=dev` reportó tres vulnerabilidades de severidad alta asociadas transitivamente a `deepmerge-ts <8`, a través de `@prisma/config`/Prisma. La recomendación automática implicaba un downgrade de Prisma y no se aplicó por el riesgo de incompatibilidad.
  - Repetir `npm audit` con el lockfile actual y confirmar versiones y avisos vigentes antes de publicar.
  - Evaluar una actualización/override compatible y probar Prisma CLI, migraciones, generación de cliente, build y despliegue; alternativamente, investigar el aislamiento de herramientas de migración para reducir dependencias en la imagen de API. No aplicar un downgrade o override sin validar su compatibilidad.
  - Documentar la decisión, mitigación o aceptación temporal del riesgo, incluyendo responsable y condición para volver a evaluarlo.

- [ ] **Definir una rutina de actualización de dependencias.** Mantener lockfile, revisar avisos de seguridad de dependencias directas y transitivas y establecer quién atiende alertas y con qué frecuencia. Verificar también licencias de dependencias cuando se elija la licencia del proyecto.

- [ ] **Revisar avisos de configuración de Prisma.** La revisión anterior observó que Prisma advierte sobre la configuración `package.json#prisma` obsoleta para Prisma 7.
  - Confirmar si el aviso sigue vigente con las versiones actuales y migrar la configuración al formato soportado, coordinando los cambios de Prisma CLI, schema, migraciones y CI.

## 4. Pruebas, CI y comportamiento en producción

- [ ] **Agregar pruebas de integración con PostgreSQL.** Las pruebas existentes y verificaciones previas no cubrían exhaustivamente el comportamiento real contra una base de datos.
  - Incorporar un servicio PostgreSQL reproducible en CI y probar migraciones desde una base limpia, persistencia, transacciones, errores de conexión y operaciones críticas de API.
  - Verificar que las pruebas limpien sus datos y puedan ejecutarse localmente con instrucciones documentadas.

- [ ] **Cubrir concurrencia, delegaciones y streaming en despliegues con varias réplicas.** Quedan riesgos que las pruebas unitarias no resuelven, especialmente alrededor de leases, recuperación ante fallos y eventos SSE.
  - Probar carreras de turnos, expiración de leases, workers que caen, estados terminales, autorización entre usuarios, paginación/reconexión con `Last-Event-ID` y consistencia entre réplicas usando PostgreSQL real.
  - Comprobar límites de tiempo, cancelación y comportamiento cuando el cliente se desconecta; dejar explícito que los streams interrumpidos no se reanudan automáticamente si eso continúa siendo el contrato.

- [ ] **Ampliar pruebas de UI y flujos end-to-end.** La verificación anterior no incluyó pruebas de integración completas de UI ni pruebas end-to-end con proveedores externos.
  - Cubrir al menos autenticación/configuración, selección de perfil, conversación, errores y visualización de salidas/herramientas; usar mocks para servicios externos y reservar pruebas controladas para proveedores reales.
  - **Requiere decisión de los responsables:** determinar qué proveedores y navegadores/plataformas forman parte de la matriz de soporte.

- [ ] **Consolidar y documentar CI de contribución y publicación.** La revisión anterior verificó typecheck, build, pruebas de API, Docker y Compose; el workflow de imágenes incluía pruebas, pero no se había demostrado una suite de integración completa.
  - Confirmar que los workflows ejecuten `npm ci`, tests, typecheck, build y comprobaciones de Docker/Compose en los cambios pertinentes, y que una falla impida publicar imágenes.
  - Definir cómo se publican versiones, tags e imágenes reproducibles, cómo se asocian a commits/releases y cómo se corrigen publicaciones defectuosas.
  - Evitar que CI necesite secretos de producción para validar pull requests; documentar los secretos mínimos requeridos para publicar.

## 5. Instalación y distribución

- [ ] **Alinear el SDK con la intención de distribución.** `packages/client` está marcado como privado y la documentación indica que todavía no está publicado en npm.
  - **Requiere decisión de los responsables:** decidir si el SDK se publicará en un registro, se instalará desde Git o permanecerá como paquete interno.
  - Si se publica, definir nombre y scope, versión, licencia, archivos incluidos, exports, compatibilidad de Node, changelog, procedimiento de release y pruebas de instalación desde el artefacto empaquetado. Si no, mantener la limitación claramente documentada.

- [ ] **Completar y probar los caminos de instalación.** El README describe Compose local, y `deploy/` requiere preparar `deploy/.env`; la instalación basada en imágenes publicadas no tenía un equivalente escalable documentado en la revisión anterior.
  - Probar desde un clon limpio los caminos oficialmente soportados, incluyendo inicialización de secretos, migraciones, persistencia, actualización y recuperación.
  - Decidir si se ofrece un Compose escalable con imágenes publicadas; si sí, agregarlo y documentar balanceo, health checks, persistencia y configuración. Si no, declarar el alcance de forma visible.
  - Explicar las diferencias entre Compose de desarrollo y despliegue, puertos expuestos, requisitos de PostgreSQL, proxy/TLS, actualización y respaldo/restauración.

- [ ] **Validar los requisitos de plataforma.** El proyecto requiere Node `>=24` según el manifiesto observado y las verificaciones anteriores mostraron advertencias al usar Node 20; las pruebas también se ejecutaron con Node 24.
  - Confirmar y documentar la versión soportada de Node, Docker/Compose y PostgreSQL. Asegurar que README, `engines`, CI y Dockerfile coincidan y probar instalación con esas versiones en un entorno limpio.

## 6. Documentación, transparencia y revisión final

- [ ] **Revisar documentación para que coincida con el comportamiento real.** En la revisión anterior se corrigieron discrepancias sobre endpoints del SDK y la integración de Memory. Antes de publicar, volver a contrastar README, guías HTTP, variables de entorno, Compose y ejemplos con el código actual.
  - Incluir ejemplos seguros que no usen secretos reales, explicar errores comunes y diferenciar valores solo locales de configuraciones de producción.
  - Revisar enlaces, instrucciones desde una copia limpia y cualquier afirmación de compatibilidad o seguridad.

- [ ] **Documentar operación y límites conocidos.** Explicar generación, almacenamiento, rotación y recuperación de claves; copias de seguridad; migraciones; logs; health checks; límites de request; retención de datos; y efectos de reinicios o pérdida de workers.
  - **Requiere decisión de los responsables:** política de retención y privacidad, telemetría (si existe), soporte operativo y compromisos de disponibilidad.

- [ ] **Hacer una revisión final de contenido y estado del repositorio.** Comprobar que no se incluyan secretos, `.env`, dumps, artefactos, datos personales ni archivos locales; confirmar `.gitignore` y el contenido de los artefactos Docker/npm. Revisar los cambios staged y no staged para evitar publicar trabajo incompleto o accidental.
  - Verificar licencia de archivos incorporados, avisos de terceros y procedencia de assets de UI/documentación.

## Criterio sugerido para cerrar esta lista

Antes de anunciar el proyecto como listo para uso público, conviene que las decisiones marcadas estén documentadas, que los hallazgos de seguridad estén resueltos o aceptados explícitamente, que la instalación se haya probado desde cero y que CI cubra al menos las rutas críticas de API, base de datos y despliegue. La publicación debe describir con honestidad las limitaciones que permanezcan; completar esta lista no sustituye una revisión legal ni una evaluación de seguridad especializada.
