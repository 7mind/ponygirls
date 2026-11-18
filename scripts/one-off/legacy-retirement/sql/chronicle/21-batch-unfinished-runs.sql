\if :lr_more_unfinished
\if :lr_apply
BEGIN;
\endif
-- Accepted checkpoints and annotation attempts carry hashes computed from the profile and embedding-space ids of
-- the run. Every unfinished run whose identity is about to change (a v1 namespace row is removed, or its profile
-- leaves a v1 space) would meet those hashes again on retry and stop the worker with `internal`. Its accepted work
-- is discarded and its annotation budget restarted, as a manual retry does; state, run and rebuild position stay.
DO $$
DECLARE
  jobs uuid[];
  checkpoints bigint;
BEGIN
  SELECT array_agg(d.id) INTO jobs FROM (
    SELECT j.id FROM ch_jobs j
    WHERE j.state IS DISTINCT FROM 'Complete' AND (
      EXISTS (SELECT 1 FROM ch_checkpoint_namespaces n WHERE n.job_id = j.id AND n.run_id = j.run_id)
      OR (j.profile IN (SELECT p.profile FROM ch_index_profiles p JOIN ch_embedding_spaces e ON e.id = p.embedding_space WHERE (jsonb_typeof(e.descriptor) = 'array' AND e.descriptor->>0 = 'embedding-space-v2') IS NOT TRUE)
          AND (EXISTS (SELECT 1 FROM ch_index_checkpoints c WHERE c.job_id = j.id AND c.run_id = j.run_id)
            OR EXISTS (SELECT 1 FROM ch_annotation_attempts a WHERE a.job_id = j.id AND a.run_id = j.run_id AND a.retry_epoch = j.annotation_retry_epoch))))
    ORDER BY j.id LIMIT current_setting('lr.batch_size')::int FOR UPDATE OF j) d;
  IF jobs IS NULL THEN
    PERFORM set_config('lr.batch_n', '0', false); PERFORM set_config('lr.batch_checkpoints', '0', false);
    RETURN;
  END IF;
  DELETE FROM ch_index_checkpoints c USING ch_jobs j WHERE j.id = ANY (jobs) AND c.job_id = j.id AND c.run_id = j.run_id;
  GET DIAGNOSTICS checkpoints = ROW_COUNT;
  DELETE FROM ch_checkpoint_namespaces n USING ch_jobs j WHERE j.id = ANY (jobs) AND n.job_id = j.id AND n.run_id = j.run_id;
  UPDATE ch_jobs SET annotation_retry_epoch = annotation_retry_epoch + 1, fence = fence + 1 WHERE id = ANY (jobs);
  PERFORM set_config('lr.batch_n', cardinality(jobs)::text, false); PERFORM set_config('lr.batch_checkpoints', checkpoints::text, false);
END $$;
SELECT current_setting('lr.batch_n')::int AS lr_n, current_setting('lr.batch_checkpoints')::bigint AS lr_checkpoints,
       current_setting('lr.batch_n')::int >= :batch_size AS lr_more_unfinished \gset
\echo LR.step.unfinished_runs_reset|:lr_n
\echo LR.step.unfinished_run_checkpoints_deleted|:lr_checkpoints
\if :lr_apply
COMMIT;
\endif
\endif
