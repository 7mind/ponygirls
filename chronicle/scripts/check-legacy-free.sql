-- Post-deployment check of a Chronicle database after the legacy clean-up (run by the operator; read-only).
--   psql -X -q -v ON_ERROR_STOP=1 -f chronicle/scripts/check-legacy-free.sql      (or the same file on standard input)
-- Optional: -v require_formats=f when the two old publication formats were deliberately kept.
-- Prints `LF.<key>|<count>` lines and `LF.result|legacy-free`; any other outcome fails the session (exit 3).
-- It references no table the clean-up drops, so it keeps working after the one-off retirement scripts are gone.
\set ON_ERROR_STOP on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
\if :{?require_formats}
\else
\set require_formats t
\endif
SET default_transaction_read_only = on;
SET statement_timeout = '120s';
SET lock_timeout = '5s';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LF.database', current_database();
SELECT 'LF.schema_migrations', coalesce(string_agg(version::text, ',' ORDER BY version), '') FROM ch_schema_migrations;
SELECT count(*) AS lf_tables FROM (VALUES ('ch_retained_profile_reads'), ('ch_checkpoint_namespaces'), ('ch_model_identity_migrations'), ('ch_profile')) t(name)
WHERE to_regclass(t.name) IS NOT NULL \gset
SELECT count(*) AS lf_spaces FROM ch_embedding_spaces WHERE (jsonb_typeof(descriptor) = 'array' AND descriptor->>0 = 'embedding-space-v2') IS NOT TRUE \gset
SELECT count(*) AS lf_targets FROM ch_owner_targets t
WHERE NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = t.profile AND p.policy = 'ContextAwareProblemsV1') \gset
SELECT count(*) AS lf_published FROM ch_sources s JOIN ch_generations g ON g.id = s.published
WHERE g.retired OR NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = g.profile) \gset
SELECT count(*) AS lf_sessions FROM ch_sessions WHERE expires IS NOT NULL \gset
SELECT count(*) AS lf_formats FROM ch_generations g
WHERE NOT g.retired AND (g.passage_format IS DISTINCT FROM 'ContextAwareProblems'
   OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy IS DISTINCT FROM 'ContextAwareProblemsV1')) \gset
SELECT count(*) AS lf_constraint FROM pg_constraint WHERE conrelid = 'ch_generations'::regclass AND conname = 'ch_generations_current_format_check' \gset
SELECT count(*) AS lf_tombstones FROM ch_generations WHERE retired \gset
ROLLBACK;
\echo LF.legacy_tables_present|:lf_tables
\echo LF.embedding_spaces.not_v2|:lf_spaces
\echo LF.owner_targets.not_executable|:lf_targets
\echo LF.published.retired_or_unregistered|:lf_published
\echo LF.sessions.deadline|:lf_sessions
\echo LF.generations.not_retired_old_format|:lf_formats
\echo LF.generations.current_format_constraint|:lf_constraint
\echo LF.info.generations.retired_tombstones|:lf_tombstones
SELECT (:lf_tables = 0 AND :lf_spaces = 0 AND :lf_targets = 0 AND :lf_published = 0 AND :lf_sessions = 0
        AND (NOT :'require_formats'::boolean OR (:lf_formats = 0 AND :lf_constraint = 1))) AS lf_ok \gset
\if :lf_ok
\if :require_formats
\echo LF.result|legacy-free
\else
\echo LF.result|legacy-free-formats-kept
\endif
\else
\echo LF.result|legacy-present
DO $$ BEGIN RAISE EXCEPTION 'chronicle legacy-free check failed (see LF.* lines above)'; END $$;
\endif
