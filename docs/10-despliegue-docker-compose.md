# Despliegue con Docker Compose

El ejemplo de [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) instala Runtime desde la imagen publicada en GHCR, sin clonar ni compilar el código. **Incluye PostgreSQL con pgvector** en un contenedor y un volumen persistente. Una tarea efímera aplica las migraciones a esa base antes de iniciar la API y la UI.

## Requisitos

- Docker Engine y Docker Compose v2.
- Acceso a `ghcr.io` si el paquete de la imagen es privado.
- Un hostname y un proxy inverso con TLS si se va a exponer públicamente.

## Preparar configuración

Desde la raíz del repositorio:

```sh
cp deploy/.env.example deploy/.env
openssl rand -hex 24  # contraseña de PostgreSQL
openssl rand -hex 32  # clave de cifrado de Runtime
```

En PowerShell, copiá el archivo con `Copy-Item deploy/.env.example deploy/.env`. Editá `deploy/.env`, reemplazá `RUNTIME_CONFIG_ENCRYPTION_KEY` por una clave generada y elegí la versión publicada en `AGENT_RUNTIME_VERSION`. La clave de cifrado debe ser hexadecimal (64 caracteres). `PORT` configura el puerto interno en el que escucha Runtime; no configura el puerto publicado por Docker Compose. En el Compose de ejemplo actual, las credenciales de PostgreSQL y la URL de conexión de las migraciones están definidas directamente en `deploy/docker-compose.yml`, no se leen de `deploy/.env`.

Conservá `RUNTIME_CONFIG_ENCRYPTION_KEY` en un gestor de secretos o backup seguro. Si se pierde o se cambia, Runtime no podrá descifrar la configuración persistida. No publiques `deploy/.env` ni incluyas sus valores en la imagen.

`AGENT_RUNTIME_VERSION` queda fijada por defecto a `0.1.0` en el ejemplo. Cambiala por la versión publicada que quieras desplegar; preferí una versión fija en lugar de `latest` para poder reproducir y controlar las actualizaciones.

## Iniciar

```sh
docker compose --env-file deploy/.env -f deploy/docker-compose.yml pull
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d
```

La UI y la API quedan disponibles en `http://localhost:3030`. El mapeo del puerto publicado (`127.0.0.1:3030:3030`) pertenece a Docker Compose: el primer puerto es el del host y el segundo el puerto del contenedor. En este ejemplo, el puerto publicado está fijo en el Compose; para cambiarlo, modificá el lado izquierdo del mapeo. El puerto interno debe coincidir con el puerto en el que escucha Runtime (`PORT`, definido en `deploy/.env`). PostgreSQL no se publica en el host en este Compose; Runtime y las migraciones se conectan a la base por la red interna de Compose en `postgres:5432`. En este Compose, el usuario, la base, la contraseña y el `DATABASE_URL` interno están escritos directamente en `deploy/docker-compose.yml`; PostgreSQL no se publica en un puerto del host.

El puerto de Runtime también se enlaza a `127.0.0.1`, por lo que solo es accesible desde el host. Para exponerlo, colocá un proxy inverso con TLS delante. **Cambiá `RUNTIME_ADMIN_USERNAME` y `RUNTIME_ADMIN_PASSWORD` en `deploy/.env` antes de exponer Runtime**; el acceso local de recuperación usa `admin/admin` por defecto y funciona independientemente del proveedor de autenticación. La lista de admins habituales se guarda en PostgreSQL y se administra desde la pestaña **Administradores**. En una instalación nueva, inicializá la introspección y el primer administrador habitual con el comando dentro de la imagen (el `userId` debe ser el que entrega ese endpoint): `docker compose --env-file deploy/.env -f deploy/docker-compose.yml run --rm --entrypoint node agent-runtime apps/api/dist/runtime-config/bootstrap-admin.js <verified-user-id> --introspect-url <url>`. Si la introspección no está configurada o no puede verificarse la identidad, los Bearer del proveedor se deniegan, pero la cuenta local de recuperación sigue disponible.

Los datos de PostgreSQL se conservan en el volumen Docker `pgdata`. `docker compose down` detiene y elimina los contenedores, pero mantiene el volumen. **No uses `down -v` salvo que quieras borrar la base y todos sus datos.** Configurá backups regulares y probá su restauración.

## Operación

```sh
# Ver estado y logs
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f agent-runtime

# Actualizar: editar AGENT_RUNTIME_VERSION en deploy/.env y luego
docker compose --env-file deploy/.env -f deploy/docker-compose.yml pull
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d

# Detener y quitar contenedores, conservando pgdata
docker compose --env-file deploy/.env -f deploy/docker-compose.yml down
```

Las migraciones se aplican automáticamente antes de iniciar Runtime. Este Compose está pensado como instalación sencilla de una instancia. Para varias réplicas detrás de HAProxy, usá el Compose escalable de desarrollo en la raíz como referencia; todavía no hay un Compose escalable para las imágenes publicadas.
