CREATE TABLE rt_users (
  id text PRIMARY KEY, login text NOT NULL UNIQUE, enabled boolean NOT NULL,
  credential text NOT NULL
);
CREATE TABLE rt_sessions (
  hash text PRIMARY KEY, owner text NOT NULL REFERENCES rt_users(id) ON DELETE CASCADE,
  expires timestamptz NOT NULL
);
CREATE INDEX rt_sessions_owner ON rt_sessions(owner);
CREATE TABLE rt_credentials (
  id uuid PRIMARY KEY, owner text NOT NULL REFERENCES rt_users(id),
  name text NOT NULL, forge text NOT NULL, host text NOT NULL,
  revision integer NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  key_id text NOT NULL, nonce bytea NOT NULL, ciphertext bytea NOT NULL,
  mode text NOT NULL DEFAULT 'Token' CHECK(mode IN('Token','Oauth')), oauth_client_id text, expires_at timestamptz,
  refresh_health text NOT NULL DEFAULT 'Healthy' CHECK(refresh_health IN('Healthy','Due','Uncertain','Failed')), generation bigint NOT NULL DEFAULT 1,
  refresh_key_id text, refresh_nonce bytea, refresh_ciphertext bytea,
  refresh_intent boolean NOT NULL DEFAULT false,
  CHECK((mode='Token' AND oauth_client_id IS NULL AND expires_at IS NULL AND refresh_ciphertext IS NULL)
    OR (mode='Oauth' AND oauth_client_id IS NOT NULL AND expires_at IS NOT NULL AND refresh_key_id IS NOT NULL AND refresh_nonce IS NOT NULL AND refresh_ciphertext IS NOT NULL)),
  UNIQUE(owner,id)
);
CREATE INDEX rt_credentials_owner ON rt_credentials(owner);
CREATE TABLE rt_repositories (
  id text PRIMARY KEY, owner text NOT NULL REFERENCES rt_users(id),
  forge text NOT NULL, host text NOT NULL, project text NOT NULL, base_branch text NOT NULL,
  credential_id uuid NOT NULL, revision integer NOT NULL,
  FOREIGN KEY(owner,credential_id) REFERENCES rt_credentials(owner,id)
);
CREATE TABLE rt_grants (
  repository_id text NOT NULL REFERENCES rt_repositories(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES rt_users(id), role text NOT NULL CHECK(role IN('Editor','Viewer')),
  PRIMARY KEY(repository_id,user_id)
);
CREATE TABLE rt_rites (
  repository_id text NOT NULL REFERENCES rt_repositories(id) ON DELETE CASCADE,
  id text NOT NULL, schedule text NOT NULL, prompt_path text NOT NULL, model_id text NOT NULL,
  enabled boolean NOT NULL, revision integer NOT NULL, cursor timestamptz,
  active_run uuid, PRIMARY KEY(repository_id,id)
);
CREATE TABLE rt_runs (
  id uuid PRIMARY KEY, repository_id text NOT NULL, rite_id text NOT NULL,
  trigger_kind text NOT NULL, scheduled_for timestamptz NOT NULL,
  actor text, request_id uuid, request_digest text,
  state text NOT NULL, failure_code text,
  repository_revision integer NOT NULL, rite_revision integer NOT NULL,
  credential_id uuid NOT NULL, credential_revision integer NOT NULL,
  created_at timestamptz NOT NULL, started_at timestamptz, finished_at timestamptz,
  base_revision text, prompt_digest text, branch text, proposal_url text,
  marker text, expected_head text, intent_persisted boolean NOT NULL DEFAULT false,
  publication_stage text NOT NULL DEFAULT 'None', target_branch text,
  remote_id text, remote_author text, supersession_pending boolean NOT NULL DEFAULT false,
  FOREIGN KEY(repository_id,rite_id) REFERENCES rt_rites(repository_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX rt_runs_schedule_unique ON rt_runs(repository_id,rite_id,scheduled_for) WHERE trigger_kind='Schedule';
CREATE UNIQUE INDEX rt_runs_manual_unique ON rt_runs(actor,request_id) WHERE trigger_kind='Manual';
CREATE INDEX rt_runs_queue ON rt_runs(state,created_at);
CREATE INDEX rt_runs_history ON rt_runs(repository_id,rite_id,created_at DESC);
ALTER TABLE rt_rites ADD CONSTRAINT rt_active_run_fk FOREIGN KEY(active_run) REFERENCES rt_runs(id);
CREATE TABLE rt_publication_predecessors (
  run_id uuid NOT NULL REFERENCES rt_runs(id) ON DELETE CASCADE,
  remote_id text NOT NULL, closed boolean NOT NULL DEFAULT false,
  PRIMARY KEY(run_id,remote_id)
);
