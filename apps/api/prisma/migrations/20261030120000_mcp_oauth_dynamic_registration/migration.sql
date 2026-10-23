-- OAuth Dynamic Client Registration credentials are shared per MCP/issuer and encrypted by the application.
CREATE TABLE runtime.mcp_oauth_clients (
  mcp_name text NOT NULL,
  issuer text NOT NULL,
  client_ciphertext bytea NOT NULL,
  client_nonce bytea NOT NULL,
  client_tag bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (mcp_name, issuer)
);
