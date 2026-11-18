-- Post-deployment check of a Manure database after the legacy clean-up (run by the operator; read-only).
--   psql -X -q -v ON_ERROR_STOP=1 -f manure/scripts/check-legacy-free.sql        (or the same file on standard input)
-- Prints `LF.<key>|<count>` lines and `LF.result|legacy-free`; any other outcome fails the session (exit 3).
-- Manure keeps no legacy data of its own (docs/drafts/20261118-1100-legacy-data-retirement.md §3.3): this checks the
-- shared retrieval registry only. The rule is the same as in haystack/scripts/check-legacy-free.sql: the block from
-- "Shared retrieval registry" to the LP.retrieval lines is identical text there; change both together.
-- Tested by manure/backend/src/test/scala/manure/LegacyFreeCheckSuite.scala: a clean database, seeded legacy rows.
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
-- Shared retrieval registry (Haystack, Manure): every descriptor must be a proven embedding-space-v2 8-tuple
-- ["embedding-space-v2", model, revision, dimensions 1..4000, sendDimensions, queryPrefix, documentPrefix, "cosine"]
-- (what EmbeddingSpace.verified checks structurally); invalid JSON or any NULL/failed test counts as not proven.
-- Not checked (not reproducible in SQL): the id equals the hash of the compact JSON; the product refuses such a row.
SELECT to_regclass('pony_retrieval_profiles') IS NOT NULL AS lp_has_retrieval \gset
\if :lp_has_retrieval
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
\else
\set lp_retrieval_profiles 0
\set lp_retrieval_not_v2 0
\endif
\echo LP.retrieval.profiles|:lp_retrieval_profiles
\echo LP.retrieval.not_proven_v2|:lp_retrieval_not_v2
ROLLBACK;
SELECT (:lp_retrieval_not_v2 = 0) AS lf_ok \gset
\if :lf_ok
\echo LF.result|legacy-free
\else
\echo LF.result|legacy-present
DO $$ BEGIN RAISE EXCEPTION 'manure legacy-free check failed (see LF.* / LP.* lines above)'; END $$;
\endif
