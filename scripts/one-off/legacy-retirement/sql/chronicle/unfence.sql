-- Removes the fence set by fence.sql. Idempotent; restores LOGIN only on a role carrying this tool's marker.
SET statement_timeout = '15s';
SET lock_timeout = '5s';
SELECT set_config('lr.role', :'lr_role', false) \gset lr_ignored_
SELECT 'LR.fence.before', r.rolname, CASE WHEN r.rolcanlogin THEN 'login' ELSE 'nologin' END,
       coalesce(shobj_description(r.oid, 'pg_authid'), '-'), (SELECT count(*) FROM pg_stat_activity a WHERE a.usename = r.rolname)
FROM pg_roles r WHERE r.rolname = :'lr_role';
DO $$
DECLARE r record; marker text;
BEGIN
  SELECT oid, rolcanlogin INTO r FROM pg_roles WHERE rolname = current_setting('lr.role');
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy-retirement refused: role % does not exist', current_setting('lr.role'); END IF;
  marker := shobj_description(r.oid, 'pg_authid');
  IF NOT r.rolcanlogin THEN
    IF marker IS NULL OR marker NOT LIKE 'legacy-retirement fence since %' THEN
      RAISE EXCEPTION 'legacy-retirement refused: role % is NOLOGIN but was not fenced by this tool', current_setting('lr.role');
    END IF;
    EXECUTE format('ALTER ROLE %I LOGIN', current_setting('lr.role'));
  END IF;
  IF marker LIKE 'legacy-retirement fence since %' THEN
    EXECUTE format('COMMENT ON ROLE %I IS NULL', current_setting('lr.role'));
  END IF;
END $$;
SELECT 'LR.fence.after', r.rolname, CASE WHEN r.rolcanlogin THEN 'login' ELSE 'nologin' END,
       coalesce(shobj_description(r.oid, 'pg_authid'), '-'), (SELECT count(*) FROM pg_stat_activity a WHERE a.usename = r.rolname)
FROM pg_roles r WHERE r.rolname = :'lr_role';
\echo LR.result|unfenced
