-- Chronicle worklist: read-only. One line per source still published in a retired output format, with the
-- identifiers an operator needs to find the head job on the owner's target in the product (Activity, by job id)
-- and the job's state and error code. Identifiers and codes only; no content.
SET default_transaction_read_only = on;
SET statement_timeout = :'statement_timeout';
SET lock_timeout = :'lock_timeout';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LR.database', current_database();
SELECT 'LR.reindex_job', coalesce(j.id::text, 'no-target-job'), s.id, s.owner, s.revision, g.revision,
       CASE WHEN u.enabled THEN 'owner-enabled' ELSE 'owner-disabled' END, coalesce(g.passage_format, '<null>'),
       coalesce(j.state, '-'), coalesce(j.error, '-')
FROM ch_sources s JOIN ch_generations g ON g.id = s.published JOIN ch_users u ON u.id = s.owner
LEFT JOIN ch_owner_targets t ON t.owner = s.owner
LEFT JOIN ch_jobs j ON j.session_id = s.id AND j.revision = s.revision AND j.profile = t.profile
WHERE NOT g.retired AND (g.passage_format IS DISTINCT FROM 'ContextAwareProblems'
   OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy IS DISTINCT FROM 'ContextAwareProblemsV1'))
ORDER BY s.owner, s.id;
SELECT 'LR.reindex_jobs', count(*) FROM ch_sources s JOIN ch_generations g ON g.id = s.published
WHERE NOT g.retired AND (g.passage_format IS DISTINCT FROM 'ContextAwareProblems'
   OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy IS DISTINCT FROM 'ContextAwareProblemsV1'));
ROLLBACK;
\echo LR.columns|job_id|source_id|owner_id|source_revision|published_revision|owner_state|format|job_state|job_error
\echo LR.result|worklist-complete
