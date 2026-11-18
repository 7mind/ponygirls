\if :lr_more_jobs
\if :lr_apply
BEGIN;
\endif
-- Jobs of retired policies can never run again (the worker refuses them); their checkpoints, attempts and
-- namespace rows go with them through the existing ON DELETE CASCADE.
WITH doomed AS (
  SELECT j.id FROM ch_jobs j
  WHERE j.profile IN (SELECT profile FROM ch_index_profiles WHERE policy <> 'ContextAwareProblemsV1')
  ORDER BY j.id LIMIT :batch_size FOR UPDATE OF j
), gone AS (
  DELETE FROM ch_jobs j USING doomed d WHERE j.id = d.id RETURNING 1
)
SELECT count(*) AS lr_n, count(*) >= :batch_size AS lr_more_jobs FROM gone \gset
\echo LR.step.retired_policy_jobs_deleted|:lr_n
\if :lr_apply
COMMIT;
\endif
\endif
