-- Chronicle preflight: read-only legacy counters, worklists, backup sizes and the plan token for apply.
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
-- The structural predicates shared with verify and the retained post-deployment check (block shared:chronicle).
-- Diagnostics only here: the migration selects its rows by the counters above, not by these lines.
\ir_shared chronicle chronicle
-- Generations in a retired output format, by format and state. `history` rows are readable pinned views.
SELECT 'LR.old_format', coalesce(g.passage_format, '<null>'),
       CASE WHEN g.retired THEN 'retired-tombstone' WHEN EXISTS (SELECT 1 FROM ch_sources s WHERE s.published = g.id) THEN 'published' ELSE 'history' END, count(*)
FROM ch_generations g
WHERE g.passage_format IS DISTINCT FROM 'ContextAwareProblems' OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy IS DISTINCT FROM 'ContextAwareProblemsV1')
GROUP BY 2, 3 ORDER BY 2, 3;
-- Worklist for the product re-index: published generations in a retired format, by owner state and by the state of
-- the head job on the owner's target profile. Counts and safe codes only.
SELECT 'LR.reindex_worklist', CASE WHEN u.enabled THEN 'owner-enabled' ELSE 'owner-disabled' END,
       coalesce(g.passage_format, '<null>'), CASE WHEN g.revision = s.revision THEN 'head' ELSE 'stale-revision' END,
       coalesce(j.state, 'no-target-job'), coalesce(j.error, '-'), count(*)
FROM ch_sources s JOIN ch_generations g ON g.id = s.published JOIN ch_users u ON u.id = s.owner
LEFT JOIN ch_owner_targets t ON t.owner = s.owner
LEFT JOIN ch_jobs j ON j.session_id = s.id AND j.revision = s.revision AND j.profile = t.profile
WHERE NOT g.retired AND (g.passage_format IS DISTINCT FROM 'ContextAwareProblems'
   OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy IS DISTINCT FROM 'ContextAwareProblemsV1'))
GROUP BY 2, 3, 4, 5, 6 ORDER BY 2, 3, 4, 5, 6;
-- Publications whose model identity is v1 (relocated or re-homed by SQL, no model), by policy and format.
SELECT 'LR.relocation_worklist', p.policy, coalesce(g.passage_format, '<null>'), count(*)
FROM ch_sources s JOIN ch_generations g ON g.id = s.published JOIN ch_index_profiles p ON p.profile = g.profile
JOIN ch_embedding_spaces e ON e.id = p.embedding_space
WHERE (jsonb_typeof(e.descriptor) = 'array' AND e.descriptor->>0 = 'embedding-space-v2') IS NOT TRUE GROUP BY 2, 3 ORDER BY 2, 3;
-- Unfinished runs whose accepted work will be discarded, by job state.
SELECT 'LR.unfinished_runs', j.state, count(*) FROM ch_jobs j
WHERE j.state IS DISTINCT FROM 'Complete' AND (EXISTS (SELECT 1 FROM ch_checkpoint_namespaces n WHERE n.job_id = j.id AND n.run_id = j.run_id)
   OR (j.profile IN (SELECT p.profile FROM ch_index_profiles p JOIN ch_embedding_spaces e ON e.id = p.embedding_space WHERE (jsonb_typeof(e.descriptor) = 'array' AND e.descriptor->>0 = 'embedding-space-v2') IS NOT TRUE)
       AND (EXISTS (SELECT 1 FROM ch_index_checkpoints c WHERE c.job_id = j.id AND c.run_id = j.run_id)
         OR EXISTS (SELECT 1 FROM ch_annotation_attempts a WHERE a.job_id = j.id AND a.run_id = j.run_id AND a.retry_epoch = j.annotation_retry_epoch))))
GROUP BY 2 ORDER BY 2;
-- Space a backup needs (bytes): a snapshot or a same-cluster template copy needs the database size; a pg_dump
-- needs at most the table data (heap and TOAST, before compression), optionally without accepted checkpoints.
SELECT 'LR.size.database_bytes', pg_database_size(current_database());
SELECT 'LR.size.table_data_bytes', coalesce(sum(pg_table_size(c.oid)), 0)::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = 'public';
SELECT 'LR.size.table_data_without_checkpoints_bytes', coalesce(sum(pg_table_size(c.oid)), 0)::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relname <> 'ch_index_checkpoints';
SELECT 'LR.other_client_backends', count(*) FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';
ROLLBACK;
\echo LR.result|preflight-complete
