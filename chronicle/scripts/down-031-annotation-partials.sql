-- Rollback of resumable annotation continuations, migration 031 (R-g part 2, ANNOT2). Run by an operator with the server
-- stopped, only for a full revert: the release before it starts on a database migrated to 031 (it neither reads nor
-- writes the new table, marker or columns) and annotates an unfinished window in full. This script drops
-- ch_annotation_partials, ch_annotation_active_chains and the attempt columns accepted_continuations,
-- continued_kept_hash and chain_id. The rows of kept answers stay with their reason annotation-partition-continued, which
-- the earlier release counts among a window's five non-final answers. Before an older rollback run it first, then
-- down-029 (030 needs no script).
--   psql -X -q -v ON_ERROR_STOP=1 [-v mode=preflight] -f chronicle/scripts/down-031-annotation-partials.sql    (read-only; prints the plan)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=dry-run -f …    (every change, then ROLLBACK)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=apply -v apply_irreversible=yes -v confirm_database=<name> -v expect_plan=<token> -f …
-- Prints `DOWN031.<key>|<value>` lines; the last line is `DOWN031.result|<outcome>`. Any refusal happens before the
-- first change and exits 3. One transaction: a cut run changed nothing; run the preflight again.
-- Tested by chronicle/server/src/test/scala/chronicle/AnnotationContinuationTest.scala.
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
  to_regclass('public.ch_annotation_partials') IS NOT NULL AS d_present, current_database() AS d_database \gset
\if :d_known
\else
\echo DOWN031.result|refused-unknown-mode
DO $$ BEGIN RAISE EXCEPTION 'down-031 refused: mode is preflight, dry-run or apply'; END $$;
\endif
\echo DOWN031.database|:d_database
\if :d_present
\else
\echo DOWN031.result|absent
\quit
\endif
\if :d_preflight
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
\else
BEGIN;
LOCK TABLE ch_annotation_attempts, ch_annotation_partials, ch_annotation_active_chains IN ACCESS EXCLUSIVE MODE;
\endif
SELECT
  (SELECT count(*) FROM ch_annotation_partials) AS d_partials,
  (SELECT count(*) FROM ch_annotation_active_chains WHERE active_chain IS NOT NULL) AS d_chains,
  (SELECT count(*) FROM ch_annotation_attempts WHERE accepted_continuations IS NOT NULL) AS d_accepted,
  (SELECT count(*) FROM ch_annotation_attempts WHERE continued_kept_hash IS NOT NULL OR chain_id IS NOT NULL) AS d_continued \gset
-- The plan token binds the partial rows and every count above.
SELECT md5(concat_ws('|', (SELECT string_agg(concat_ws(':', job_id, run_id, retry_epoch, window_ordinal, attempt, kept_hash), ',' ORDER BY job_id, run_id, retry_epoch, window_ordinal) FROM ch_annotation_partials),
  :d_partials, :d_chains, :d_accepted, :d_continued)) AS d_plan \gset
\echo DOWN031.partials|:d_partials
\echo DOWN031.active_chains|:d_chains
\echo DOWN031.attempts.accepted|:d_accepted
\echo DOWN031.attempts.continued|:d_continued
\echo DOWN031.plan|:d_plan
\if :d_preflight
ROLLBACK;
\echo DOWN031.result|preflight-complete
\quit
\endif
\if :d_apply
SELECT :'apply_irreversible' = 'yes' AND :'confirm_database' = current_database() AND :'expect_plan' = :'d_plan' AS d_confirmed \gset
\if :d_confirmed
\else
ROLLBACK;
\echo DOWN031.result|refused-unconfirmed
DO $$ BEGIN RAISE EXCEPTION 'down-031 refused before any change: apply needs apply_irreversible=yes, confirm_database=<this database> and expect_plan=<the preflight plan>'; END $$;
\endif
\endif
DROP TABLE ch_annotation_partials, ch_annotation_active_chains;
ALTER TABLE ch_annotation_attempts DROP COLUMN accepted_continuations, DROP COLUMN continued_kept_hash, DROP COLUMN chain_id;
DELETE FROM ch_schema_migrations WHERE version = 31;
\if :d_apply
COMMIT;
\echo DOWN031.result|applied
\else
ROLLBACK;
\echo DOWN031.result|dry-run-complete
\endif
