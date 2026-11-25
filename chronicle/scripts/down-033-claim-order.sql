-- Rollback of the claim order's columns, migration 033 (docs/drafts/20261124-2138-indexing-claim-order-spec.md §5.5). Run by
-- an operator with the server stopped, only for a full revert: the release before it starts on a database migrated to 033
-- (its inserts name their columns, so its jobs get NULLs; it never reads them) and claims in its own order. This script
-- drops ch_jobs.waiting_since and ch_jobs.bulk with their four indexes (ch_jobs_class, ch_jobs_age, ch_jobs_sized,
-- ch_jobs_running) and the ledger row 33; every other column of every job stays as it is. A later start of this release
-- migrates again and fills every unfinished job with one start time (the ages before the revert are lost).
--   psql -X -q -v ON_ERROR_STOP=1 [-v mode=preflight] -f chronicle/scripts/down-033-claim-order.sql    (read-only; prints the plan)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=dry-run -f …    (every change, then ROLLBACK)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=apply -v apply_irreversible=yes -v confirm_database=<name> -v expect_plan=<token> -f …
-- Prints `DOWN033.<key>|<value>` lines; the last line is `DOWN033.result|<outcome>`. Any refusal happens before the
-- first change and exits 3. One transaction: a cut run changed nothing; run the preflight again.
-- Tested by chronicle/server/src/test/scala/chronicle/ClaimOrderMigrationTest.scala.
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
  EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid = 'public.ch_jobs'::regclass AND attname = 'waiting_since' AND NOT attisdropped) AS d_present,
  current_database() AS d_database \gset
\if :d_known
\else
\echo DOWN033.result|refused-unknown-mode
DO $$ BEGIN RAISE EXCEPTION 'down-033 refused: mode is preflight, dry-run or apply'; END $$;
\endif
\echo DOWN033.database|:d_database
\if :d_present
\else
\echo DOWN033.result|absent
\quit
\endif
\if :d_preflight
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
\else
BEGIN;
LOCK TABLE ch_jobs IN ACCESS EXCLUSIVE MODE;
\endif
SELECT
  (SELECT count(*) FROM ch_jobs WHERE waiting_since IS NOT NULL) AS d_waiting,
  (SELECT count(*) FROM ch_jobs WHERE bulk) AS d_bulk,
  (SELECT count(*) FROM ch_jobs WHERE state IN ('Queued', 'Running') AND (waiting_since IS NULL OR bulk IS NULL)) AS d_unfilled,
  (SELECT count(*) FROM pg_class WHERE relname IN ('ch_jobs_class', 'ch_jobs_age', 'ch_jobs_sized', 'ch_jobs_running') AND relkind = 'i') AS d_indexes \gset
-- The plan token binds every job's values and the counts above.
SELECT md5(concat_ws('|', (SELECT string_agg(concat_ws(':', id, waiting_since, bulk), ',' ORDER BY id) FROM ch_jobs WHERE waiting_since IS NOT NULL OR bulk IS NOT NULL),
  :d_waiting, :d_bulk, :d_unfilled, :d_indexes)) AS d_plan \gset
\echo DOWN033.jobs.waiting_since|:d_waiting
\echo DOWN033.jobs.bulk|:d_bulk
\echo DOWN033.jobs.unfilled|:d_unfilled
\echo DOWN033.indexes|:d_indexes
\echo DOWN033.plan|:d_plan
\if :d_preflight
ROLLBACK;
\echo DOWN033.result|preflight-complete
\quit
\endif
\if :d_apply
SELECT :'apply_irreversible' = 'yes' AND :'confirm_database' = current_database() AND :'expect_plan' = :'d_plan' AS d_confirmed \gset
\if :d_confirmed
\else
ROLLBACK;
\echo DOWN033.result|refused-unconfirmed
DO $$ BEGIN RAISE EXCEPTION 'down-033 refused before any change: apply needs apply_irreversible=yes, confirm_database=<this database> and expect_plan=<the preflight plan>'; END $$;
\endif
\endif
DROP INDEX IF EXISTS ch_jobs_class, ch_jobs_age, ch_jobs_sized, ch_jobs_running;
ALTER TABLE ch_jobs DROP COLUMN waiting_since, DROP COLUMN bulk;
DELETE FROM ch_schema_migrations WHERE version = 33;
\if :d_apply
COMMIT;
\echo DOWN033.result|applied
\else
ROLLBACK;
\echo DOWN033.result|dry-run-complete
\endif
