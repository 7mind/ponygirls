-- Rollback of the streamed publication, migration 026 (docs/drafts/20261121-0055-ingest-limits-spec.md §5.3). Run by an
-- operator with the server stopped; then deploy the release before it (whose start does not re-create these objects).
-- It deletes every staged generation with all its rows (chunks, search rows, pieces, passages, spans, Context spans,
-- tags; a staged generation is never published, so no reader loses anything), deletes the search rows of generations a
-- switch replaced that are still being retired, resets ch_search_chunks' autovacuum settings and drops
-- ch_staged_generations and ch_search_retirements. Published generations, jobs and checkpoints stay: a job whose staged
-- generation is deleted publishes again from its checkpoints under the previous release. Without this script that
-- release fails such a job's publication: its run's chunk ids are those of the staged rows.
--   psql -X -q -v ON_ERROR_STOP=1 [-v mode=preflight] -f chronicle/scripts/down-026-staged-generations.sql    (read-only; prints the plan)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=dry-run -f …    (every change, then ROLLBACK)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=apply -v apply_irreversible=yes -v confirm_database=<name> -v expect_plan=<token> -f …
-- Prints `DOWN026.<key>|<value>` lines; the last line is `DOWN026.result|<outcome>`. Any refusal happens before the
-- first change and exits 3. One transaction: a cut run changed nothing; run the preflight again.
-- Tested by chronicle/server/src/test/scala/chronicle/StagedGenerationTest.scala.
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
  to_regclass('public.ch_staged_generations') IS NOT NULL AS d_present, current_database() AS d_database \gset
\if :d_known
\else
\echo DOWN026.result|refused-unknown-mode
DO $$ BEGIN RAISE EXCEPTION 'down-026 refused: mode is preflight, dry-run or apply'; END $$;
\endif
\echo DOWN026.database|:d_database
\if :d_present
\else
\echo DOWN026.result|absent
\quit
\endif
\if :d_preflight
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
\else
BEGIN;
LOCK TABLE ch_staged_generations, ch_search_retirements IN ACCESS EXCLUSIVE MODE;
\endif
SELECT
  (SELECT count(*) FROM ch_staged_generations WHERE run_id <> generation) AS d_staged,
  (SELECT count(*) FROM ch_staged_generations WHERE run_id = generation) AS d_abandoned,
  (SELECT count(*) FROM ch_chunks ch JOIN ch_staged_generations st ON st.generation = ch.generation) AS d_chunks,
  (SELECT count(*) FROM ch_search_chunks s JOIN ch_chunks ch ON ch.id = s.id JOIN ch_staged_generations st ON st.generation = ch.generation) AS d_search_rows,
  (SELECT count(*) FROM ch_problem_passages p JOIN ch_staged_generations st ON st.generation = p.generation) AS d_passages,
  (SELECT count(*) FROM ch_search_retirements) AS d_retirements,
  (SELECT count(*) FROM ch_search_chunks s JOIN ch_chunks ch ON ch.id = s.id JOIN ch_search_retirements r ON r.generation = ch.generation) AS d_retired_rows,
  coalesce((SELECT array_to_string(reloptions, ',') FROM pg_class WHERE oid = 'ch_search_chunks'::regclass), '') AS d_reloptions \gset
-- The plan token binds the staged and retiring generations and every count above.
SELECT md5(concat_ws('|', (SELECT string_agg(concat_ws(':', generation, job_id, run_id, phase, resume::text), ',' ORDER BY generation) FROM ch_staged_generations),
  (SELECT string_agg(generation::text, ',' ORDER BY generation) FROM ch_search_retirements),
  :d_staged, :d_abandoned, :d_chunks, :d_search_rows, :d_passages, :d_retirements, :d_retired_rows)) AS d_plan \gset
\echo DOWN026.staged.generations|:d_staged
\echo DOWN026.staged.abandoned|:d_abandoned
\echo DOWN026.staged.chunks|:d_chunks
\echo DOWN026.staged.search_rows|:d_search_rows
\echo DOWN026.staged.passages|:d_passages
\echo DOWN026.retiring.generations|:d_retirements
\echo DOWN026.retiring.search_rows|:d_retired_rows
\echo DOWN026.search_chunks.reloptions|:d_reloptions
\echo DOWN026.plan|:d_plan
\if :d_preflight
ROLLBACK;
\echo DOWN026.result|preflight-complete
\quit
\endif
\if :d_apply
SELECT :'apply_irreversible' = 'yes' AND :'confirm_database' = current_database() AND :'expect_plan' = :'d_plan' AS d_confirmed \gset
\if :d_confirmed
\else
ROLLBACK;
\echo DOWN026.result|refused-unconfirmed
DO $$ BEGIN RAISE EXCEPTION 'down-026 refused before any change: apply needs apply_irreversible=yes, confirm_database=<this database> and expect_plan=<the preflight plan>'; END $$;
\endif
\endif
DELETE FROM ch_search_chunks s USING ch_chunks ch, ch_search_retirements r WHERE r.generation = ch.generation AND s.id = ch.id;
-- A staged generation's chunks take its search rows and pieces with them (ON DELETE CASCADE), its passages its spans.
DELETE FROM ch_chunks ch USING ch_staged_generations st WHERE st.generation = ch.generation;
DELETE FROM ch_problem_passages p USING ch_staged_generations st WHERE st.generation = p.generation;
DELETE FROM ch_context_spans x USING ch_staged_generations st WHERE st.generation = x.generation;
DELETE FROM ch_generation_tags t USING ch_staged_generations st WHERE st.generation = t.generation;
DELETE FROM ch_generations g USING ch_staged_generations st WHERE st.generation = g.id;
ALTER TABLE ch_search_chunks RESET (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold);
DROP TABLE ch_staged_generations, ch_search_retirements;
DELETE FROM ch_schema_migrations WHERE version = 26;
\if :d_apply
COMMIT;
\echo DOWN026.result|applied
\else
ROLLBACK;
\echo DOWN026.result|dry-run-complete
\endif
