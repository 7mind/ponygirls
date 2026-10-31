ALTER TABLE ch_jobs ADD COLUMN IF NOT EXISTS annotation_retry_epoch bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS ch_annotation_attempts(
  job_id uuid NOT NULL REFERENCES ch_jobs(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  retry_epoch bigint NOT NULL CHECK(retry_epoch>=0),
  window_ordinal integer NOT NULL CHECK(window_ordinal>=0),
  attempt integer NOT NULL CHECK(attempt>=1 AND attempt<=10),
  input_hash text NOT NULL,
  fence bigint NOT NULL CHECK(fence>=0),
  rejection_reason text CHECK(rejection_reason ~ '^[a-z][a-z0-9-]{0,63}$'),
  PRIMARY KEY(job_id,run_id,retry_epoch,window_ordinal,attempt)
);
