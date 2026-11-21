-- Window reuse for append-only growth, I2 (docs/drafts/20261121-0055-ingest-limits-spec.md §5.4): a run's window whose
-- input (the window's source and the carry) equals one an earlier run of the same source and profile accepted takes that
-- run's output instead of a model call. `content_hash` keys an own checkpoint's input without its run or revision
-- (NULL: written by an earlier release, never reused). ch_index_checkpoint_refs records each reuse as a reference of the
-- reusing run's coordinates to the exact own checkpoint it took (its full key and output hash): the publication and a
-- resumed run read the own row or the reference, never a new lookup. A coordinate holds an own checkpoint or a
-- reference. References die with their job; the foreign key to the referenced checkpoint is checked at the end of the
-- statement, so purge's one delete of the source's jobs removes jobs, checkpoints and references together.
-- Runs at every start; idempotent; DDL only. Rollback: chronicle/scripts/down-027-window-reuse.sql.
ALTER TABLE ch_index_checkpoints ADD COLUMN IF NOT EXISTS content_hash text;
CREATE INDEX IF NOT EXISTS ch_index_checkpoints_content ON ch_index_checkpoints(content_hash) WHERE content_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS ch_index_checkpoint_refs(
  job_id uuid NOT NULL REFERENCES ch_jobs(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  stage text NOT NULL CHECK(stage IN ('Annotation','Embedding')),
  window_ordinal integer NOT NULL CHECK(window_ordinal>=0),
  part integer NOT NULL CHECK(part>=0),
  -- The reusing run's checkpoint input at these coordinates (an embedding part grouped otherwise is another input).
  input_hash text NOT NULL,
  source_job uuid NOT NULL,
  source_run uuid NOT NULL,
  source_stage text NOT NULL CHECK(source_stage=stage),
  source_window integer NOT NULL,
  source_part integer NOT NULL,
  output_hash text NOT NULL,
  PRIMARY KEY(job_id,run_id,stage,window_ordinal,part),
  FOREIGN KEY(source_job,source_run,source_stage,source_window,source_part) REFERENCES ch_index_checkpoints(job_id,run_id,stage,window_ordinal,part));
-- The foreign key's check when checkpoints are deleted.
CREATE INDEX IF NOT EXISTS ch_index_checkpoint_refs_source ON ch_index_checkpoint_refs(source_job,source_run,source_stage,source_window,source_part);
INSERT INTO ch_schema_migrations VALUES(27) ON CONFLICT DO NOTHING;
