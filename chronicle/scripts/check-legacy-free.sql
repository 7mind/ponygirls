-- Post-deployment check of a Chronicle database after the legacy clean-up (run by the operator; read-only).
--   psql -X -q -v ON_ERROR_STOP=1 -f chronicle/scripts/check-legacy-free.sql      (or the same file on standard input)
-- Optional: -v require_formats=f when the two old publication formats were deliberately kept (prints LF.formats|kept).
-- Prints `LF.<key>|<count>` lines and, as the last line, `LF.result|legacy-free`; any other outcome fails (exit 3).
-- It needs nothing but psql and references no table the clean-up drops (it only looks their names up).
-- Tested by chronicle/server/src/test/scala/chronicle/LegacyFreeCheckTest.scala: a clean database, one seeded legacy
-- row per counter.
\set ON_ERROR_STOP on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
\if :{?require_formats}
\else
\set require_formats t
\endif
-- F1: resolve every table in the service's schema whatever the session's search_path (the operator runs this as
-- postgres), and refuse instead of counting when an expected table does not resolve there.
SET search_path = pg_catalog, public;
SELECT coalesce(string_agg(format('%I.%I', 'public', t), ',' ORDER BY t), '') AS lf_missing, count(*) > 0 AS lf_has_missing
FROM unnest(string_to_array('ch_embedding_spaces ch_generations ch_index_profiles ch_owner_targets ch_schema_migrations ch_sessions ch_sources', ' ')) t WHERE to_regclass(format('%I.%I', 'public', t)) IS NULL \gset
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
SELECT 'LF.schema_migrations', coalesce(string_agg(version::text, ',' ORDER BY version), '') FROM ch_schema_migrations;
-- "Proven current" means the full shape the product's structural checks require (a NULL or failed test counts as not
-- proven: IS NOT TRUE). Embedding space v2: ["embedding-space-v2", model, revision, dimensions 1..4000,
-- sendDimensions, queryPrefix, documentPrefix, "cosine"]. Index profile v2 (current policy): ["index-profile-
-- descriptor-v2", [four non-empty strings], non-empty string]. Not checked (cannot be reproduced in SQL): that the
-- id equals the hash of the descriptor's compact JSON; the product refuses such a row at run time ("unavailable").
SELECT
  -- nested CASE: SQL does not guarantee the evaluation order of AND, CASE does (no cast or length on a wrong type)
  (SELECT count(*) FROM ch_embedding_spaces WHERE (CASE WHEN jsonb_typeof(descriptor) = 'array' THEN
      CASE WHEN jsonb_array_length(descriptor) = 8 AND jsonb_typeof(descriptor->3) = 'number' THEN
        descriptor->>0 = 'embedding-space-v2' AND jsonb_typeof(descriptor->1) = 'string' AND descriptor->>1 <> ''
        AND jsonb_typeof(descriptor->2) = 'string' AND descriptor->>2 <> ''
        AND (descriptor->>3)::numeric BETWEEN 1 AND 4000 AND (descriptor->>3)::numeric = trunc((descriptor->>3)::numeric)
        AND jsonb_typeof(descriptor->4) = 'boolean' AND jsonb_typeof(descriptor->5) = 'string' AND jsonb_typeof(descriptor->6) = 'string'
        AND jsonb_typeof(descriptor->7) = 'string' AND descriptor->>7 = 'cosine'
      ELSE false END ELSE false END) IS NOT TRUE) AS lp_spaces,
  (SELECT count(*) FROM ch_index_profiles WHERE policy = 'ContextAwareProblemsV1' AND (CASE WHEN jsonb_typeof(descriptor) = 'array' THEN
      CASE WHEN jsonb_array_length(descriptor) = 3 AND jsonb_typeof(descriptor->1) = 'array' THEN
        CASE WHEN jsonb_array_length(descriptor->1) = 4 THEN
          descriptor->>0 = 'index-profile-descriptor-v2'
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(descriptor->1) e WHERE jsonb_typeof(e) <> 'string' OR e #>> '{}' = '')
          AND jsonb_typeof(descriptor->2) = 'string' AND descriptor->>2 <> ''
        ELSE false END ELSE false END ELSE false END) IS NOT TRUE) AS lp_profiles,
  (SELECT count(*) FROM ch_index_profiles p WHERE p.embedding_space NOT IN (SELECT id FROM ch_embedding_spaces)) AS lp_profiles_unbound,
  (SELECT count(*) FROM ch_owner_targets t WHERE NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = t.profile AND p.policy = 'ContextAwareProblemsV1')) AS lp_targets,
  (SELECT count(*) FROM ch_sources s JOIN ch_generations g ON g.id = s.published
     WHERE g.retired IS NOT FALSE OR NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = g.profile)) AS lp_published,
  (SELECT count(*) FROM ch_generations g WHERE NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = g.profile)) AS lp_unregistered,
  (SELECT count(*) FROM ch_sessions WHERE expires IS NOT NULL) AS lp_sessions,
  (SELECT count(*) FROM ch_generations g WHERE g.retired IS NOT TRUE AND (g.passage_format IS DISTINCT FROM 'ContextAwareProblems'
     OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy IS DISTINCT FROM 'ContextAwareProblemsV1'))) AS lp_formats \gset
\echo LP.embedding_spaces.not_proven_v2|:lp_spaces
\echo LP.index_profiles.current_policy_not_proven_v2|:lp_profiles
\echo LP.index_profiles.space_unregistered|:lp_profiles_unbound
\echo LP.owner_targets.not_executable|:lp_targets
\echo LP.published.retired_or_unregistered|:lp_published
\echo LP.generations.unregistered_profile|:lp_unregistered
\echo LP.sessions.deadline|:lp_sessions
\echo LP.generations.not_retired_old_format|:lp_formats
SELECT (:lp_spaces + :lp_profiles + :lp_profiles_unbound + :lp_targets + :lp_published + :lp_unregistered + :lp_sessions) = 0 AS lp_identity_clean,
       :lp_formats = 0 AS lp_formats_clean \gset
-- Absence is the clean state for these four (the clean-up drops them): counted in the service's schema explicitly.
SELECT count(*) AS lf_tables FROM (VALUES ('ch_retained_profile_reads'), ('ch_checkpoint_namespaces'), ('ch_model_identity_migrations'), ('ch_profile')) t(name)
WHERE to_regclass(format('%I.%I', 'public', t.name)) IS NOT NULL \gset
SELECT count(*) AS lf_constraint FROM pg_constraint WHERE conrelid = 'ch_generations'::regclass AND conname = 'ch_generations_current_format_check' \gset
SELECT count(*) AS lf_tombstones FROM ch_generations WHERE retired \gset
ROLLBACK;
\echo LF.legacy_tables_present|:lf_tables
\echo LF.generations.current_format_constraint|:lf_constraint
\echo LF.info.generations.retired_tombstones|:lf_tombstones
SELECT (:lf_tables = 0 AND :'lp_identity_clean'::boolean
        AND (NOT :'require_formats'::boolean OR (:'lp_formats_clean'::boolean AND :lf_constraint = 1))) AS lf_ok \gset
\if :require_formats
\else
\echo LF.formats|kept
\endif
\if :lf_ok
\echo LF.result|legacy-free
\else
\echo LF.result|legacy-present
DO $$ BEGIN RAISE EXCEPTION 'chronicle legacy-free check failed (see LF.* / LP.* lines above)'; END $$;
\endif
