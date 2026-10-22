# OAuth de servidores MCP configurados en Runtime

Runtime administra OAuth por entrada MCP y por usuario. No hay providers de MCP hardcodeados: el nombre lógico, URL y credenciales OAuth se leen de `mcpConfig` en **Administración → Runtime → MCP**.

## Configuración

En la entrada de cada servidor que soporte OAuth, agregá el bloque `oauth` junto con `url`:

```json
{
  "mi_mcp": {
    "url": "https://mcp.example.com/mcp",
    "auth": null,
    "headers": {},
    "oauth": {
      "clientId": "CLIENT_ID_REGISTRADO_EN_EL_SERVIDOR",
      "clientSecret": "CLIENT_SECRET",
      "scopes": ["tools:read"]
    },
    "optional": true
  }
}
```

El client id/secret son de la aplicación OAuth registrada para ese servidor MCP; `clientSecret` puede omitirse si se registró un cliente público. Cada servidor puede usar un cliente distinto y scopes distintos. Runtime descubre Protected Resource Metadata del MCP y Authorization Server Metadata (RFC 8414); no asume que el token emitido por un proveedor sirva para otro servidor. El servidor debe exponer `authorization_servers` en `/.well-known/oauth-protected-resource` (también se prueba la forma ligada al path del recurso), y el authorization server debe publicar sus endpoints estándar. Este corte utiliza Authorization Code + PKCE y admite refresh tokens cuando el servidor los emite.

Configurá en Runtime:

- `MCP_OAUTH_REDIRECT_URI`: callback exacto registrado en los authorization servers: `https://<runtime-host>/oauth/mcp/callback`.
- `MCP_OAUTH_ENCRYPTION_KEY`: clave independiente de 32 bytes hexadecimales; generar con `openssl rand -hex 32`.
- Opcional, `MCP_OAUTH_UI_REDIRECT_URL`: URL de retorno de la UI cuando se sirve desde otro origen.

Al guardar `oauth.clientSecret`, Runtime lo enmascara al leer la configuración y retiene el secreto existente si se devuelve el marcador `********`. En UI abrir **MCP → Conectar** para autorizar cada servidor. El token queda cifrado en base de datos y se adjunta solo a las solicitudes del MCP correspondiente y del usuario correspondiente.

## Límites y operación

- La configuración OAuth es por servidor; Runtime no implementa Dynamic Client Registration. Registrá el cliente OAuth en cada servidor/authorization server y usa el mismo callback.
- Los endpoint de autorización/token deben ser HTTPS (se admite localhost para desarrollo).
- La disponibilidad de scopes, refresh, revocación y logout depende del authorization server. Desconectar elimina las credenciales locales; la revocación remota debe hacerse con el mecanismo del proveedor.
- Servidores MCP sin bloque `oauth` siguen usando su modo de autenticación existente (`auth`, headers estáticos o `X-MCP-Auth`).
- Si un token vence sin refresh token, el usuario debe volver a conectar.
- La identidad del usuario depende del principal autenticado de Runtime; los tokens se aíslan por su `userId`.

Aplicá la migración con `npm run prisma:deploy -w apps/api` después de configurar la base de datos.
