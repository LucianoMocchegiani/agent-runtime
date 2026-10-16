-- Coordinación de turnos entre todas las instancias de Runtime.
CREATE SCHEMA IF NOT EXISTS runtime;

CREATE TABLE runtime.conversation_turn_leases (
  user_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  owner_token uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX conversation_turn_leases_expires_at_idx
  ON runtime.conversation_turn_leases (expires_at);
