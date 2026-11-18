-- Haystack migrate, part 1: session limits and refusals. Nothing is changed here.
SET statement_timeout = :'statement_timeout';
SET lock_timeout = :'lock_timeout';
SET client_min_messages = warning;
SELECT set_config('lr.mode', :'mode', false), set_config('lr.confirm_database', :'confirm_database', false),
       set_config('lr.expect_plan', :'expect_plan', false), set_config('lr.allow_connections', :'allow_connections', false) \gset lr_ignored_
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
  SELECT coalesce(string_agg(version, ',' ORDER BY version), '') INTO versions FROM schema_migrations;
  IF versions <> '0001-initial,0002-search,0003-tags,0004-scala-current,0005-exact-numeric-query,0006-tag-completion' THEN
    RAISE EXCEPTION 'legacy-retirement refused: unexpected schema_migrations (%); this script is bound to 0001..0006', versions;
  END IF;
  SELECT count(*) INTO n FROM haystack_contract_cutovers WHERE contract = 'haystack.api/1.0.0';
  IF n <> 1 THEN RAISE EXCEPTION 'legacy-retirement refused: the Scala cut-over marker is absent'; END IF;
  -- A Node-format row written after the cut-over means something still writes that format: do not delete evidence.
  SELECT count(*) INTO n FROM write_requests w, haystack_contract_cutovers c
  WHERE c.contract = 'haystack.api/1.0.0' AND w.digest_format = 'haystack-op-v1' AND w.created_at >= c.installed_at;
  IF n > 0 THEN RAISE EXCEPTION 'legacy-retirement refused: % haystack-op-v1 replay row(s) were created after the Scala cut-over', n; END IF;
  SELECT count(*) INTO n FROM write_requests WHERE digest_format NOT IN ('haystack-op-v1', 'haystack-op-scala-v1');
  IF n > 0 THEN RAISE EXCEPTION 'legacy-retirement refused: % replay row(s) carry an unknown digest format', n; END IF;
  SELECT count(*) INTO n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';
  IF n > 0 AND current_setting('lr.allow_connections') <> 't' THEN
    RAISE EXCEPTION 'legacy-retirement refused: % other client connection(s) to this database; stop the service (or pass --allow-active-connections knowingly)', n;
  END IF;
END $$;
\if :lr_apply
\echo LR.guards|passed-apply
\else
\echo LR.guards|passed-dry-run
\endif
\set lr_more_replay t
