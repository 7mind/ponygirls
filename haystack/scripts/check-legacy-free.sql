-- Post-deployment check of a Haystack database after the legacy clean-up (run by the operator; read-only).
--   psql -X -q -v ON_ERROR_STOP=1 -f haystack/scripts/check-legacy-free.sql       (or the same file on standard input)
-- Prints `LF.<key>|<count>` lines and `LF.result|legacy-free`; any other outcome fails the session (exit 3).
-- Stored documents are not judged here: once the wide stored-read tolerance is removed, the service itself answers
-- `unavailable` for a document outside the current envelope (that was verified with the real codec beforehand).
-- Tested by haystack/server/src/test/scala/haystack/storage/LegacyFreeCheckTest.scala: a clean database, one seeded
-- legacy row per counter.
\set ON_ERROR_STOP on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
-- F1: resolve every table in the service's schema whatever the session's search_path (the operator runs this as
-- postgres), and refuse instead of counting when an expected table does not resolve there.
SET search_path = pg_catalog, public;
SELECT coalesce(string_agg(format('%I.%I', 'public', t), ',' ORDER BY t), '') AS lf_missing, count(*) > 0 AS lf_has_missing
FROM unnest(string_to_array('pony_retrieval_profiles schema_migrations write_requests', ' ')) t WHERE to_regclass(format('%I.%I', 'public', t)) IS NULL \gset
\if :lf_has_missing
\echo LF.missing|:lf_missing
\echo LF.result|refused-missing-objects
SELECT set_config('lf.missing', :'lf_missing', false) \gset lf_ignored_
DO $$ BEGIN RAISE EXCEPTION 'legacy-free check refused: expected tables do not resolve (%), so nothing is counted: wrong database, schema or role', current_setting('lf.missing'); END $$;
\endif
SET default_transaction_read_only = on;
SET statement_timeout = '120s';
SET lock_timeout = '5s';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LF.database', current_database();
SELECT 'LF.schema_migrations', coalesce(string_agg(version, ',' ORDER BY version), '') FROM schema_migrations;
SELECT count(*) AS lp_replay FROM write_requests WHERE digest_format IS DISTINCT FROM 'haystack-op-scala-v1' \gset
\echo LP.replay.other_digest_format|:lp_replay
-- Shared retrieval registry (Haystack, Manure): every descriptor must be a proven embedding-space-v2 8-tuple
-- ["embedding-space-v2", model, revision, dimensions 1..4000, sendDimensions, queryPrefix, documentPrefix, "cosine"]
-- (what EmbeddingSpace.verified checks structurally); invalid JSON or any NULL/failed test counts as not proven.
-- Not checked (not reproducible in SQL): the id equals the hash of the compact JSON; the product refuses such a row.
-- The table is required: the presence check above has resolved it (no "absent counts as zero").
SELECT count(*) AS lp_retrieval_profiles,
  count(*) FILTER (WHERE (CASE WHEN pg_input_is_valid(descriptor, 'jsonb') THEN
    CASE WHEN jsonb_typeof(descriptor::jsonb) = 'array' THEN
      CASE WHEN jsonb_array_length(descriptor::jsonb) = 8 AND jsonb_typeof(descriptor::jsonb->3) = 'number' THEN
        descriptor::jsonb->>0 = 'embedding-space-v2' AND jsonb_typeof(descriptor::jsonb->1) = 'string' AND descriptor::jsonb->>1 <> ''
        AND jsonb_typeof(descriptor::jsonb->2) = 'string' AND descriptor::jsonb->>2 <> ''
        AND (descriptor::jsonb->>3)::numeric BETWEEN 1 AND 4000 AND (descriptor::jsonb->>3)::numeric = trunc((descriptor::jsonb->>3)::numeric)
        AND jsonb_typeof(descriptor::jsonb->4) = 'boolean' AND jsonb_typeof(descriptor::jsonb->5) = 'string'
        AND jsonb_typeof(descriptor::jsonb->6) = 'string' AND jsonb_typeof(descriptor::jsonb->7) = 'string' AND descriptor::jsonb->>7 = 'cosine'
      ELSE false END ELSE false END ELSE false END) IS NOT TRUE) AS lp_retrieval_not_v2
FROM pony_retrieval_profiles \gset
\echo LP.retrieval.profiles|:lp_retrieval_profiles
\echo LP.retrieval.not_proven_v2|:lp_retrieval_not_v2
SELECT count(*) AS lf_default FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
WHERE d.adrelid = 'write_requests'::regclass AND a.attname = 'digest_format' \gset
SELECT count(*) AS lf_constraint FROM pg_constraint WHERE conrelid = 'write_requests'::regclass AND conname = 'write_requests_current_digest_format_check' \gset
SELECT count(*) AS lf_marker FROM schema_migrations WHERE version = '0007-node-replay-retired' \gset
ROLLBACK;
\echo LF.replay.column_default_present|:lf_default
\echo LF.replay.current_format_constraint|:lf_constraint
\echo LF.schema.node_replay_retired_marker|:lf_marker
SELECT (:lp_replay = 0 AND :lp_retrieval_not_v2 = 0 AND :lf_default = 0 AND :lf_constraint = 1 AND :lf_marker = 1) AS lf_ok \gset
\if :lf_ok
\echo LF.result|legacy-free
\else
\echo LF.result|legacy-present
DO $$ BEGIN RAISE EXCEPTION 'haystack legacy-free check failed (see LF.* / LP.* lines above)'; END $$;
\endif
