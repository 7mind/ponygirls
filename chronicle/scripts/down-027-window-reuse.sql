-- Rollback of window reuse, migration 027 (docs/drafts/20261121-0055-ingest-limits-spec.md §5.4). Run by an operator with
-- the server stopped, before the release before it starts (and before down-026 when rolling back further).
-- That release reads a run's own checkpoints only: each reference of a job that is not Complete is copied into an own
-- checkpoint at its coordinates (the referenced output and output hash, the reference's input hash), so such a run
-- resumes from exactly the work it accepted (its staged generation was written from it). A Complete job's run never
-- resumes (RetryJob and a rebuild start a new run): its references go with the table. Then it drops
-- ch_index_checkpoint_refs, the content index and ch_index_checkpoints.content_hash. Published generations, jobs and
-- own checkpoints stay.
--   psql -X -q -v ON_ERROR_STOP=1 [-v mode=preflight] -f chronicle/scripts/down-027-window-reuse.sql    (read-only; prints the plan)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=dry-run -f …    (every change, then ROLLBACK)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=apply -v apply_irreversible=yes -v confirm_database=<name> -v expect_plan=<token> -f …
-- Prints `DOWN027.<key>|<value>` lines; the last line is `DOWN027.result|<outcome>`. Any refusal happens before the
-- first change and exits 3. One transaction: a cut run changed nothing; run the preflight again.
-- Tested by chronicle/server/src/test/scala/chronicle/WindowReuseTest.scala.
\set ON_ERROR_STOP on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
\if :{?mode}
\else
\set mode preflight
\endif
\if :{?apply_irreversible}
\else
\set apply_irreversible no
\endif
\if :{?confirm_database}
\else
\set confirm_database ''
\endif
\if :{?expect_plan}
\else
\set expect_plan ''
\endif
SET search_path = pg_catalog, public;
SET statement_timeout = 0;
SET lock_timeout = '5s';
SELECT :'mode' IN ('preflight', 'dry-run', 'apply') AS d_known, :'mode' = 'preflight' AS d_preflight, :'mode' = 'apply' AS d_apply,
  to_regclass('public.ch_index_checkpoint_refs') IS NOT NULL AS d_present, current_database() AS d_database \gset
\if :d_known
\else
\echo DOWN027.result|refused-unknown-mode
DO $$ BEGIN RAISE EXCEPTION 'down-027 refused: mode is preflight, dry-run or apply'; END $$;
\endif
\echo DOWN027.database|:d_database
\if :d_present
\else
\echo DOWN027.result|absent
\quit
\endif
\if :d_preflight
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
\else
BEGIN;
LOCK TABLE ch_index_checkpoint_refs, ch_index_checkpoints IN ACCESS EXCLUSIVE MODE;
\endif
-- The references copied: those of jobs that are not Complete, with the outputs they name.
\set copied 'SELECT r.job_id, r.run_id, r.stage, r.window_ordinal, r.part, r.input_hash, r.output_hash, k.value FROM ch_index_checkpoint_refs r JOIN ch_jobs j ON j.id = r.job_id JOIN ch_index_checkpoints k ON k.job_id = r.source_job AND k.run_id = r.source_run AND k.stage = r.source_stage AND k.window_ordinal = r.source_window AND k.part = r.source_part WHERE j.state <> ''Complete'''
WITH copied AS (:copied) SELECT
  (SELECT count(*) FROM ch_index_checkpoint_refs) AS d_references,
  (SELECT count(*) FROM copied) AS d_copied,
  (SELECT count(DISTINCT job_id) FROM copied) AS d_jobs,
  (SELECT coalesce(sum(octet_length(value)), 0) FROM copied) AS d_bytes,
  (SELECT count(*) FROM ch_index_checkpoints WHERE content_hash IS NOT NULL) AS d_hashed \gset
-- The plan token binds the copied references and every count above.
WITH copied AS (:copied) SELECT md5(concat_ws('|', (SELECT string_agg(concat_ws(':', job_id, run_id, stage, window_ordinal, part, input_hash, output_hash), ',' ORDER BY job_id, run_id, stage, window_ordinal, part) FROM copied),
  :d_references, :d_copied, :d_jobs, :d_bytes, :d_hashed)) AS d_plan \gset
\echo DOWN027.references|:d_references
\echo DOWN027.references.copied|:d_copied
\echo DOWN027.references.copied_jobs|:d_jobs
\echo DOWN027.references.copied_bytes|:d_bytes
\echo DOWN027.checkpoints.content_hashed|:d_hashed
\echo DOWN027.plan|:d_plan
\if :d_preflight
ROLLBACK;
\echo DOWN027.result|preflight-complete
\quit
\endif
\if :d_apply
SELECT :'apply_irreversible' = 'yes' AND :'confirm_database' = current_database() AND :'expect_plan' = :'d_plan' AS d_confirmed \gset
\if :d_confirmed
\else
ROLLBACK;
\echo DOWN027.result|refused-unconfirmed
DO $$ BEGIN RAISE EXCEPTION 'down-027 refused before any change: apply needs apply_irreversible=yes, confirm_database=<this database> and expect_plan=<the preflight plan>'; END $$;
\endif
\endif
-- A coordinate holds an own checkpoint or a reference, never both: a conflict here is a fault and changes nothing.
WITH copied AS (:copied) INSERT INTO ch_index_checkpoints(job_id, run_id, stage, window_ordinal, part, input_hash, output_hash, value)
  SELECT job_id, run_id, stage, window_ordinal, part, input_hash, output_hash, value FROM copied;
DROP TABLE ch_index_checkpoint_refs;
DROP INDEX ch_index_checkpoints_content;
ALTER TABLE ch_index_checkpoints DROP COLUMN content_hash;
DELETE FROM ch_schema_migrations WHERE version = 27;
\if :d_apply
COMMIT;
\echo DOWN027.result|applied
\else
ROLLBACK;
\echo DOWN027.result|dry-run-complete
\endif
