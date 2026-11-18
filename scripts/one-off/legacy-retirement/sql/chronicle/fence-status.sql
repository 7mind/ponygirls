-- Fence status of the Chronicle service role: read-only. LOGIN state, the fence marker this tool sets, backends.
SET default_transaction_read_only = on;
SET statement_timeout = '15s';
SELECT 'LR.fence.role', r.rolname, CASE WHEN r.rolcanlogin THEN 'login' ELSE 'nologin' END,
       CASE WHEN shobj_description(r.oid, 'pg_authid') LIKE 'legacy-retirement fence since %' THEN 'marker' ELSE 'no-marker' END,
       (SELECT count(*) FROM pg_stat_activity a WHERE a.usename = r.rolname)
FROM pg_roles r WHERE r.rolname = :'lr_role';
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'lr_role') THEN 'absent'
            WHEN (SELECT rolcanlogin FROM pg_roles WHERE rolname = :'lr_role') THEN 'unfenced'
            WHEN (SELECT shobj_description(oid, 'pg_authid') FROM pg_roles WHERE rolname = :'lr_role') LIKE 'legacy-retirement fence since %' THEN 'fenced'
            ELSE 'nologin-not-by-this-tool' END AS lr_state \gset
\echo LR.fence.state|:lr_state
\echo LR.result|fence-status-complete
