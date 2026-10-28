CREATE TABLE IF NOT EXISTS ch_reindex_requests(
  owner text NOT NULL REFERENCES ch_users(id),
  request_id uuid NOT NULL,
  target_profile text NOT NULL,
  selection_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(owner,request_id)
);
CREATE TABLE IF NOT EXISTS ch_reindex_members(
  owner text NOT NULL,
  request_id uuid NOT NULL,
  session_id uuid NOT NULL,
  revision integer NOT NULL,
  job_id uuid NOT NULL,
  run_id uuid NOT NULL,
  target_epoch bigint NOT NULL,
  previous_generation uuid,
  completed_generation uuid,
  retirement_generation uuid,
  PRIMARY KEY(owner,request_id,session_id),
  FOREIGN KEY(owner,request_id) REFERENCES ch_reindex_requests(owner,request_id)
);
ALTER TABLE ch_reindex_members ADD COLUMN IF NOT EXISTS retirement_generation uuid;
CREATE INDEX IF NOT EXISTS ch_reindex_members_run ON ch_reindex_members(job_id,run_id);
