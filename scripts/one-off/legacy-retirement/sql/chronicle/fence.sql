-- Database-side fence of the Chronicle service role (plan 7.2). Idempotent. Refuses a superuser, the session's own
-- role, a missing role, and a role that is NOLOGIN or carries a comment for any other reason (not ours to change).
SET statement_timeout = '15s';
SET lock_timeout = '5s';
SELECT set_config('lr.role', :'lr_role', false) \gset lr_ignored_
SELECT 'LR.fence.before', r.rolname, CASE WHEN r.rolcanlogin THEN 'login' ELSE 'nologin' END,
       coalesce(shobj_description(r.oid, 'pg_authid'), '-'), (SELECT count(*) FROM pg_stat_activity a WHERE a.usename = r.rolname)
FROM pg_roles r WHERE r.rolname = :'lr_role';
DO $$
DECLARE r record; marker text;
BEGIN
  SELECT oid, rolcanlogin, rolsuper INTO r FROM pg_roles WHERE rolname = current_setting('lr.role');
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy-retirement refused: role % does not exist', current_setting('lr.role'); END IF;
  IF r.rolsuper THEN RAISE EXCEPTION 'legacy-retirement refused: % is a superuser', current_setting('lr.role'); END IF;
  IF current_setting('lr.role') = current_user OR current_setting('lr.role') = session_user THEN
    RAISE EXCEPTION 'legacy-retirement refused: the fence would lock out this session''s own role';
  END IF;
  marker := shobj_description(r.oid, 'pg_authid');
  IF r.rolcanlogin THEN
    IF marker IS NOT NULL AND marker NOT LIKE 'legacy-retirement fence since %' THEN
      RAISE EXCEPTION 'legacy-retirement refused: role % carries a comment this tool did not write', current_setting('lr.role');
    END IF;
    EXECUTE format('COMMENT ON ROLE %I IS %L', current_setting('lr.role'), 'legacy-retirement fence since ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
    EXECUTE format('ALTER ROLE %I NOLOGIN', current_setting('lr.role'));
  ELSIF marker IS NULL OR marker NOT LIKE 'legacy-retirement fence since %' THEN
    RAISE EXCEPTION 'legacy-retirement refused: role % is NOLOGIN but was not fenced by this tool', current_setting('lr.role');
  END IF;
END $$;
-- NOLOGIN is committed: no new session of the role can start. End the existing ones (all databases).
SELECT 'LR.fence.terminated', count(*) FILTER (WHERE pg_terminate_backend(pid, 5000)) FROM pg_stat_activity WHERE usename = :'lr_role';
SELECT pg_sleep(1) \gset lr_ignored_
SELECT 'LR.fence.after', r.rolname, CASE WHEN r.rolcanlogin THEN 'login' ELSE 'nologin' END,
       coalesce(shobj_description(r.oid, 'pg_authid'), '-'), (SELECT count(*) FROM pg_stat_activity a WHERE a.usename = r.rolname)
FROM pg_roles r WHERE r.rolname = :'lr_role';
SELECT NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = :'lr_role')
   AND NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = :'lr_role') AS lr_fenced \gset
\if :lr_fenced
\echo LR.result|fenced
\else
DO $$ BEGIN RAISE EXCEPTION 'legacy-retirement fence: backends of the role remain; run fence again'; END $$;
\endif
