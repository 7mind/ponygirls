-- Automatic claims and Failed retry preserve a run; Complete recompute/rebuild rotates without rewriting old artifacts.
ALTER TABLE ch_jobs ADD COLUMN IF NOT EXISTS run_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE ch_jobs ADD COLUMN IF NOT EXISTS failure_stage text;
-- Earlier startup reconciliation replaces these errors before this migration runs.
UPDATE ch_jobs SET failure_stage=NULL WHERE failure_stage IS NOT NULL AND error IN('superseded-revision','lease-exhausted','explicit-rebuild-superseded');
CREATE TABLE IF NOT EXISTS ch_index_checkpoints(
  job_id uuid NOT NULL REFERENCES ch_jobs(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  stage text NOT NULL CHECK(stage IN ('Annotation','Embedding')),
  window_ordinal integer NOT NULL CHECK(window_ordinal>=0),
  part integer NOT NULL CHECK(part>=0),
  input_hash text NOT NULL,
  output_hash text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY(job_id,run_id,stage,window_ordinal,part)
);
-- Opaque validated JSON must retain numeric lexemes (scientific notation and negative zero).
ALTER TABLE ch_index_checkpoints ALTER COLUMN value TYPE text USING value::text;
