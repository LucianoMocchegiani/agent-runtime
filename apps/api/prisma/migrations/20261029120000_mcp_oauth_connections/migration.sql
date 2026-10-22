-- OAuth por usuario y servidor MCP dinámico; tokens cifrados a nivel de aplicación.
CREATE SCHEMA IF NOT EXISTS runtime;

CREATE TABLE runtime.mcp_oauth_connections (
  user_id text NOT NULL,
  mcp_name text NOT NULL,
  account_login text,
  token_ciphertext bytea NOT NULL,
  token_nonce bytea NOT NULL,
  token_tag bytea NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, mcp_name)
);

CREATE TABLE runtime.mcp_oauth_states (
  state_hash text PRIMARY KEY,
  user_id text NOT NULL,
  mcp_name text NOT NULL,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX mcp_oauth_states_expiry_idx ON runtime.mcp_oauth_states (expires_at);
