-- Post-deployment check of a Haystack database after the legacy clean-up (run by the operator; read-only).
--   psql -X -q -v ON_ERROR_STOP=1 -f haystack/scripts/check-legacy-free.sql       (or the same file on standard input)
-- Prints `LF.<key>|<count>` lines and `LF.result|legacy-free`; any other outcome fails the session (exit 3).
-- Stored documents are not judged here: once the wide stored-read tolerance is removed, the service itself answers
-- `unavailable` for a document outside the current envelope (that was verified with the real codec beforehand).
\set ON_ERROR_STOP on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
SET default_transaction_read_only = on;
SET statement_timeout = '120s';
SET lock_timeout = '5s';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LF.database', current_database();
SELECT 'LF.schema_migrations', coalesce(string_agg(version, ',' ORDER BY version), '') FROM schema_migrations;
SELECT count(*) AS lf_replay FROM write_requests WHERE digest_format <> 'haystack-op-scala-v1' \gset
SELECT count(*) AS lf_default FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'write_requests' AND column_name = 'digest_format' AND column_default IS NOT NULL \gset
SELECT count(*) AS lf_constraint FROM pg_constraint WHERE conrelid = 'write_requests'::regclass AND conname = 'write_requests_current_digest_format_check' \gset
SELECT count(*) AS lf_marker FROM schema_migrations WHERE version = '0007-node-replay-retired' \gset
ROLLBACK;
\echo LF.replay.other_digest_format|:lf_replay
\echo LF.replay.column_default_present|:lf_default
\echo LF.replay.current_format_constraint|:lf_constraint
\echo LF.schema.node_replay_retired_marker|:lf_marker
SELECT (:lf_replay = 0 AND :lf_default = 0 AND :lf_constraint = 1 AND :lf_marker = 1) AS lf_ok \gset
\if :lf_ok
\echo LF.result|legacy-free
\else
\echo LF.result|legacy-present
DO $$ BEGIN RAISE EXCEPTION 'haystack legacy-free check failed (see LF.* lines above)'; END $$;
\endif
