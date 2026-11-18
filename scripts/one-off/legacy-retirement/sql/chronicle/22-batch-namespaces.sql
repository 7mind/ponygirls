\if :lr_more_namespaces
\if :lr_apply
BEGIN;
\endif
-- An unfinished run that began under the v1 identity keeps its accepted checkpoints under v1 hash inputs.
-- Without the namespace row those hashes no longer match, so the accepted work of that run is discarded and the
-- annotation budget restarted (as a manual retry does); the job keeps its state, run and position in any rebuild.
WITH pick AS (
  SELECT n.job_id, n.run_id FROM ch_checkpoint_namespaces n JOIN ch_jobs j ON j.id = n.job_id AND j.run_id = n.run_id
  WHERE j.state <> 'Complete' ORDER BY n.job_id LIMIT :batch_size FOR UPDATE OF j
), checkpoints AS (
  DELETE FROM ch_index_checkpoints c USING pick p WHERE c.job_id = p.job_id AND c.run_id = p.run_id RETURNING 1
), bumped AS (
  UPDATE ch_jobs j SET annotation_retry_epoch = j.annotation_retry_epoch + 1, fence = j.fence + 1 FROM pick p WHERE j.id = p.job_id RETURNING 1
), namespaces AS (
  DELETE FROM ch_checkpoint_namespaces n USING pick p WHERE n.job_id = p.job_id AND n.run_id = p.run_id RETURNING 1
)
SELECT (SELECT count(*) FROM namespaces) AS lr_n, (SELECT count(*) FROM checkpoints) AS lr_checkpoints,
       (SELECT count(*) FROM bumped) >= :batch_size AS lr_more_namespaces \gset
\echo LR.step.unfinished_runs_reset|:lr_n
\echo LR.step.unfinished_run_checkpoints_deleted|:lr_checkpoints
\if :lr_apply
COMMIT;
\endif
\endif
