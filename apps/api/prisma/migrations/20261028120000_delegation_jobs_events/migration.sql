-- Cola persistente de delegaciones y registro recuperable de eventos.
CREATE SCHEMA IF NOT EXISTS runtime;

CREATE TABLE runtime.delegation_jobs (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  source_conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  target_conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'interrupted')),
  payload_ciphertext bytea NOT NULL,
  payload_nonce bytea NOT NULL,
  payload_tag bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_by text,
  lease_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  CHECK ((status = 'running') = (claimed_by IS NOT NULL AND lease_until IS NOT NULL))
);

CREATE INDEX delegation_jobs_claim_idx
  ON runtime.delegation_jobs (available_at, created_at)
  WHERE status = 'queued';
CREATE INDEX delegation_jobs_expired_idx
  ON runtime.delegation_jobs (lease_until)
  WHERE status = 'running';
CREATE INDEX delegation_jobs_user_idx
  ON runtime.delegation_jobs (user_id, created_at DESC);

CREATE TABLE runtime.delegation_events (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES runtime.delegation_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('queued', 'started', 'completed', 'failed', 'interrupted')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX delegation_events_job_cursor_idx
  ON runtime.delegation_events (job_id, id);
