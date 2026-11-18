-- Chronicle migrate, part 1: session limits and refusals. Nothing is changed here.
SET statement_timeout = :'statement_timeout';
SET lock_timeout = :'lock_timeout';
SET client_min_messages = warning;
SET application_name = 'legacy-retirement';
SELECT set_config('lr.mode', :'mode', false), set_config('lr.confirm_database', :'confirm_database', false),
       set_config('lr.expect_plan', :'expect_plan', false), set_config('lr.allow_connections', :'allow_connections', false),
       set_config('lr.skip_formats', :'skip_formats', false), set_config('lr.retire_history', :'retire_history', false),
       set_config('lr.confirm_retire_history', :'confirm_retire_history', false), set_config('lr.batch_size', :'batch_size', false) \gset lr_ignored_
SELECT pg_try_advisory_lock(hashtextextended('legacy-retirement', 0)) AS lr_locked \gset
\if :lr_locked
\else
DO $$ BEGIN RAISE EXCEPTION 'legacy-retirement refused: another legacy-retirement session holds the advisory lock'; END $$;
\endif
\if :lr_dry_run
BEGIN;
\endif
SELECT 'LR.database', current_database();
\echo LR.backup_reference|:backup_reference
\ir_counts
SELECT 'LR.before.' || key, value FROM counts ORDER BY key;
\ir_counts
SELECT set_config('lr.actual_plan', string_agg(value::text, '.' ORDER BY key), false) FROM counts WHERE in_plan \gset lr_ignored_
DO $$
DECLARE
  n bigint;
  versions text;
  breakdown text;
BEGIN
  IF current_setting('lr.mode') = 'apply' THEN
    IF current_setting('lr.confirm_database') IS DISTINCT FROM current_database() THEN
      RAISE EXCEPTION 'legacy-retirement refused: --confirm-database does not name the connected database';
    END IF;
    IF current_setting('lr.expect_plan') IS DISTINCT FROM current_setting('lr.actual_plan') THEN
      RAISE EXCEPTION 'legacy-retirement refused: legacy row counts differ from the preflight plan token (expected %, found %); run preflight again',
        current_setting('lr.expect_plan'), current_setting('lr.actual_plan');
    END IF;
  END IF;
  SELECT coalesce(string_agg(version::text, ',' ORDER BY version), '') INTO versions FROM ch_schema_migrations;
  IF versions <> '2,3,6,8,9,14,17,20' THEN
    RAISE EXCEPTION 'legacy-retirement refused: unexpected ch_schema_migrations (%); this script is bound to schema 2,3,6,8,9,14,17,20', versions;
  END IF;
  IF to_regclass('ch_model_identity_migrations') IS NULL OR to_regclass('ch_checkpoint_namespaces') IS NULL OR to_regclass('ch_retained_profile_reads') IS NULL THEN
    RAISE EXCEPTION 'legacy-retirement refused: model identity tables are absent; start the current binary once (migrations 018/019)';
  END IF;
  SELECT count(*) INTO n FROM ch_jobs WHERE state = 'Running' AND lease_until > clock_timestamp();
  IF n > 0 THEN
    RAISE EXCEPTION 'legacy-retirement refused: % indexing job(s) hold a live lease; stop the workers and wait for the leases to expire', n;
  END IF;
  SELECT count(*) INTO n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';
  IF n > 0 AND current_setting('lr.allow_connections') <> 't' THEN
    RAISE EXCEPTION 'legacy-retirement refused: % other client connection(s) to this database; stop the service (or pass --allow-active-connections knowingly)', n;
  END IF;
  SELECT count(*) INTO n FROM ch_owner_targets t WHERE NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = t.profile AND p.policy = 'ContextAwareProblemsV1');
  IF n > 0 THEN
    RAISE EXCEPTION 'legacy-retirement refused: % owner target(s) point at a retired or unregistered index profile; rebuild those owners with the product first', n;
  END IF;
  SELECT count(*) INTO n FROM ch_generations g WHERE NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = g.profile);
  IF n > 0 THEN
    RAISE EXCEPTION 'legacy-retirement refused: % generation(s) reference an unregistered profile; not a shape this script understands', n;
  END IF;

  -- The publication-formats item. Skipped as a whole with --skip-formats: the two old formats then stay supported.
  IF current_setting('lr.skip_formats') <> 't' THEN
    WITH old_format AS (
      SELECT coalesce(g.passage_format, '<null>') AS format,
             CASE WHEN EXISTS (SELECT 1 FROM ch_sources s WHERE s.published = g.id) THEN 'published' ELSE 'history' END AS state
      FROM ch_generations g
      WHERE NOT g.retired AND (g.passage_format IS DISTINCT FROM 'ContextAwareProblems'
         OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy <> 'ContextAwareProblemsV1'))
    ), grouped AS (SELECT format, state, count(*) AS c FROM old_format GROUP BY format, state)
    SELECT coalesce(string_agg(format || '/' || state || '=' || c, ', ' ORDER BY format, state), 'none') INTO breakdown FROM grouped;
    -- A published generation in a retired format cannot be converted or retired by SQL: it needs the product re-index.
    SELECT count(*) INTO n FROM ch_sources s JOIN ch_generations g ON g.id = s.published
    WHERE g.passage_format IS DISTINCT FROM 'ContextAwareProblems'
       OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy <> 'ContextAwareProblemsV1');
    IF n > 0 THEN
      RAISE EXCEPTION 'legacy-retirement refused: % source(s) are still published in a retired output format (%); re-index them with the product first (LR.reindex_worklist in preflight), or pass --skip-formats to leave the formats item alone', n, breakdown;
    END IF;
    -- Unpublished, not retired: a readable pinned view of an earlier revision. Never removed by default.
    SELECT count(*) INTO n FROM ch_generations g
    WHERE NOT g.retired AND (g.passage_format IS DISTINCT FROM 'ContextAwareProblems'
       OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy <> 'ContextAwareProblemsV1'));
    IF current_setting('lr.retire_history') <> 't' THEN
      IF n > 0 THEN
        RAISE EXCEPTION 'legacy-retirement refused: % historical generation(s) in a retired output format are not retired and remain readable as pinned views (%). Nothing is removed by default: pass --skip-formats, or retire them explicitly with --retire-history --confirm-retire-history %', n, breakdown, n;
      END IF;
    ELSIF current_setting('lr.confirm_retire_history') IS DISTINCT FROM n::text THEN
      RAISE EXCEPTION 'legacy-retirement refused: --confirm-retire-history must be the number of historical generations to retire (found %: %)', n, breakdown;
    END IF;
  END IF;
END $$;
\if :lr_apply
\echo LR.guards|passed-apply
\else
\echo LR.guards|passed-dry-run
\endif
\set lr_more_history :lr_retire_history
\set lr_more_unfinished t
