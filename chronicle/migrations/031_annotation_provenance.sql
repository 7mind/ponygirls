-- Resumable annotation continuations, R-g part 2 (ANNOT2): an annotation answer that stops at a fragment boundary keeps
-- its parts and the next request asks only for the rest of the window. A window's authorization rows record how it was
-- obtained: `accepted_continuations` on the accepting reservation (0: one answer; 1..4: after that many kept answers),
-- and on each kept answer's row (reason annotation-partition-continued) `continued_kept_hash`, the hash of the window's
-- kept parts after it, and `chain_id`, the chain of kept answers it belongs to. ch_annotation_partials holds the kept
-- parts of a window's unfinished chain (one row per job, run, retry epoch and window; the next claim validates it against
-- those rows and resumes), ch_annotation_active_chains the chain a window may resume. Accepted windows are stored as
-- before (complete decisions only). Earlier releases neither read nor write any of it.
-- Runs at every start; idempotent; DDL only. Rollback: chronicle/scripts/down-031-annotation-partials.sql.
ALTER TABLE ch_annotation_attempts ADD COLUMN IF NOT EXISTS accepted_continuations integer CHECK(accepted_continuations BETWEEN 0 AND 4);
ALTER TABLE ch_annotation_attempts ADD COLUMN IF NOT EXISTS continued_kept_hash text CHECK(continued_kept_hash IS NULL OR continued_kept_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE ch_annotation_attempts ADD COLUMN IF NOT EXISTS chain_id uuid;
CREATE TABLE IF NOT EXISTS ch_annotation_partials(
  job_id uuid NOT NULL REFERENCES ch_jobs(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  retry_epoch bigint NOT NULL CHECK(retry_epoch>=0),
  window_ordinal integer NOT NULL CHECK(window_ordinal>=0),
  profile text NOT NULL,
  content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
  attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 10),
  window_fragments integer NOT NULL CHECK(window_fragments BETWEEN 2 AND 64),
  covered_fragments integer NOT NULL CHECK(covered_fragments>=1 AND covered_fragments<window_fragments),
  continuations integer NOT NULL CHECK(continuations BETWEEN 1 AND 4),
  stops integer[] NOT NULL CHECK(cardinality(stops)=continuations AND stops[cardinality(stops)]=covered_fragments),
  chain_id uuid NOT NULL,
  format text NOT NULL,
  kept jsonb NOT NULL,
  kept_hash text NOT NULL,
  PRIMARY KEY(job_id,run_id,retry_epoch,window_ordinal));
CREATE TABLE IF NOT EXISTS ch_annotation_active_chains(
  job_id uuid NOT NULL REFERENCES ch_jobs(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  retry_epoch bigint NOT NULL,
  window_ordinal integer NOT NULL,
  active_chain uuid,
  PRIMARY KEY(job_id,run_id,retry_epoch,window_ordinal));
INSERT INTO ch_schema_migrations VALUES(31) ON CONFLICT DO NOTHING;
