-- Rollback of the transient failures of indexing jobs, migration 029 (docs/drafts/20261123-0055-restart-robustness-spec.md
-- §4). Run by an operator with the server stopped, before the release before it starts (and before down-028 when rolling
-- back further). That release starts on a database migrated to 029 (it neither reads nor writes the columns) and claims a
-- held job at once; this script is the way back when the columns must go: it clears the holds (the `lease_until` of Queued
-- jobs, whose next attempt is then at once) and drops ch_jobs.transient_failures and ch_jobs.transient_range. Jobs that
-- failed `database-transient` stay Failed with that error (a retry queues them as any failed job).
--   psql -X -q -v ON_ERROR_STOP=1 [-v mode=preflight] -f chronicle/scripts/down-029-transient-failures.sql    (read-only; prints the plan)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=dry-run -f …    (every change, then ROLLBACK)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=apply -v apply_irreversible=yes -v confirm_database=<name> -v expect_plan=<token> -f …
-- Prints `DOWN029.<key>|<value>` lines; the last line is `DOWN029.result|<outcome>`. Any refusal happens before the
-- first change and exits 3. One transaction: a cut run changed nothing; run the preflight again.
-- Tested by chronicle/server/src/test/scala/chronicle/TransientPublicationTest.scala.
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
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ch_jobs' AND column_name = 'transient_failures') AS d_present,
  current_database() AS d_database \gset
\if :d_known
\else
\echo DOWN029.result|refused-unknown-mode
DO $$ BEGIN RAISE EXCEPTION 'down-029 refused: mode is preflight, dry-run or apply'; END $$;
\endif
\echo DOWN029.database|:d_database
\if :d_present
\else
\echo DOWN029.result|absent
\quit
\endif
\if :d_preflight
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
\else
BEGIN;
LOCK TABLE ch_jobs IN ACCESS EXCLUSIVE MODE;
\endif
SELECT
  (SELECT count(*) FROM ch_jobs WHERE state = 'Queued' AND lease_until IS NOT NULL) AS d_held,
  (SELECT count(*) FROM ch_jobs WHERE transient_failures > 0) AS d_counted,
  (SELECT count(*) FROM ch_jobs WHERE state = 'Failed' AND error = 'database-transient') AS d_failed \gset
-- The plan token binds the held jobs and every count above.
SELECT md5(concat_ws('|', (SELECT string_agg(concat_ws(':', id, fence, lease_until), ',' ORDER BY id) FROM ch_jobs WHERE state = 'Queued' AND lease_until IS NOT NULL),
  :d_held, :d_counted, :d_failed)) AS d_plan \gset
\echo DOWN029.jobs.held|:d_held
\echo DOWN029.jobs.counted|:d_counted
\echo DOWN029.jobs.failed_transient|:d_failed
\echo DOWN029.plan|:d_plan
\if :d_preflight
ROLLBACK;
\echo DOWN029.result|preflight-complete
\quit
\endif
\if :d_apply
SELECT :'apply_irreversible' = 'yes' AND :'confirm_database' = current_database() AND :'expect_plan' = :'d_plan' AS d_confirmed \gset
\if :d_confirmed
\else
ROLLBACK;
\echo DOWN029.result|refused-unconfirmed
DO $$ BEGIN RAISE EXCEPTION 'down-029 refused before any change: apply needs apply_irreversible=yes, confirm_database=<this database> and expect_plan=<the preflight plan>'; END $$;
\endif
\endif
UPDATE ch_jobs SET lease_until = NULL WHERE state = 'Queued' AND lease_until IS NOT NULL;
ALTER TABLE ch_jobs DROP COLUMN transient_failures, DROP COLUMN transient_range;
DELETE FROM ch_schema_migrations WHERE version = 29;
\if :d_apply
COMMIT;
\echo DOWN029.result|applied
\else
ROLLBACK;
\echo DOWN029.result|dry-run-complete
\endif
