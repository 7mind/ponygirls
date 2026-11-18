-- Chronicle preflight: read-only legacy counters, the re-index worklist and the plan token for apply.
SET default_transaction_read_only = on;
SET statement_timeout = :'statement_timeout';
SET lock_timeout = :'lock_timeout';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LR.database', current_database();
SELECT 'LR.schema_migrations', coalesce(string_agg(version::text, ',' ORDER BY version), '') FROM ch_schema_migrations;
\ir_counts
SELECT 'LR.' || key, value FROM counts ORDER BY key;
\ir_counts
SELECT 'LR.plan', string_agg(value::text, '.' ORDER BY key) FROM counts WHERE in_plan;
-- Worklist for the product re-index: published generations that the SQL cannot migrate (retired output format),
-- by owner state and by the state of the head job on the owner's target profile. Counts and safe codes only.
SELECT 'LR.reindex_worklist', CASE WHEN u.enabled THEN 'owner-enabled' ELSE 'owner-disabled' END,
       coalesce(g.passage_format, '<null>'), CASE WHEN g.revision = s.revision THEN 'head' ELSE 'stale-revision' END,
       coalesce(j.state, 'no-target-job'), coalesce(j.error, '-'), count(*)
FROM ch_sources s JOIN ch_generations g ON g.id = s.published JOIN ch_users u ON u.id = s.owner
LEFT JOIN ch_owner_targets t ON t.owner = s.owner
LEFT JOIN ch_jobs j ON j.session_id = s.id AND j.revision = s.revision AND j.profile = t.profile
WHERE g.passage_format IS DISTINCT FROM 'ContextAwareProblems'
   OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy <> 'ContextAwareProblemsV1')
GROUP BY 2, 3, 4, 5, 6 ORDER BY 2, 3, 4, 5, 6;
-- The same breakdown for publications whose only legacy trait is the v1 model identity (relocated by SQL, no model).
SELECT 'LR.relocation_worklist', p.policy, coalesce(g.passage_format, '<null>'), count(*)
FROM ch_sources s JOIN ch_generations g ON g.id = s.published JOIN ch_index_profiles p ON p.profile = g.profile
JOIN ch_embedding_spaces e ON e.id = p.embedding_space
WHERE e.descriptor->>0 IS DISTINCT FROM 'embedding-space-v2' GROUP BY 2, 3 ORDER BY 2, 3;
SELECT 'LR.other_client_backends', count(*) FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';
ROLLBACK;
\echo LR.result|preflight-complete
