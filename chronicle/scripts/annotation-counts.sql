-- How the windows of a set of indexing jobs were annotated (R-g part 2, ANNOT2; docs/operations.md "Migration 031"), in
-- each job's current run and retry epoch. Read-only; the tables have no timestamps, so a caller scopes by job set.
--   psql -X -q -v ON_ERROR_STOP=1 -v jobs=<uuid>[,<uuid>...] -f chronicle/scripts/annotation-counts.sql
-- Prints `ANNOTATION.<key>|<count>` lines (ids and counts only; reasons are the stored reason codes), then
-- `ANNOTATION.result|complete`:
--   windows.one_answer / windows.after_continuation: windows accepted in one answer / after kept answers;
--   answers.continued: kept answers (reason annotation-partition-continued), of which answers.abandoned are neither in an
--     accepted window nor in an open chain; answers.rejected (and per reason): other non-final answers;
--   authorizations.no_outcome: authorizations without an answer (cancelled, crashed, transport failures);
--   chains.open: partials the next claim would resume (current run and epoch, a head-revision Queued or Running job, the
--     window not accepted, the ledger not exhausted); chains.stale: the job set's other partials (never read);
--   windows.reused: windows taken from another run's accepted work (a reference, no authorization);
--   windows.legacy: windows accepted without a recorded acceptance (by a release before 031);
--   answers: rows with a reason or an acceptance; r: answers.rejected / answers (none without answers).
-- Tested by chronicle/server/src/test/scala/chronicle/AnnotationContinuationTest.scala.
\set ON_ERROR_STOP on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
\if :{?jobs}
\else
\echo ANNOTATION.result|refused-no-jobs
DO $$ BEGIN RAISE EXCEPTION 'annotation-counts refused: name the jobs with -v jobs=<uuid>[,<uuid>...]'; END $$;
\endif
SET search_path = pg_catalog, public;
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
WITH scope AS (SELECT j.id,j.run_id,j.annotation_retry_epoch AS epoch,j.state,j.revision,j.session_id FROM ch_jobs j
    WHERE j.id = ANY(string_to_array(:'jobs', ',')::uuid[])),
  attempts AS (SELECT a.* FROM ch_annotation_attempts a JOIN scope s ON a.job_id=s.id AND a.run_id=s.run_id AND a.retry_epoch=s.epoch),
  open AS (SELECT p.* FROM ch_annotation_partials p JOIN scope s ON p.job_id=s.id AND p.run_id=s.run_id AND p.retry_epoch=s.epoch
    WHERE s.state IN ('Queued','Running') AND s.revision=(SELECT revision FROM ch_sources WHERE id=s.session_id)
      AND NOT EXISTS(SELECT 1 FROM ch_index_checkpoints k WHERE k.job_id=p.job_id AND k.run_id=p.run_id AND k.stage='Annotation' AND k.window_ordinal=p.window_ordinal)
      AND NOT EXISTS(SELECT 1 FROM ch_index_checkpoint_refs r WHERE r.job_id=p.job_id AND r.run_id=p.run_id AND r.stage='Annotation' AND r.window_ordinal=p.window_ordinal)
      AND (SELECT count(*) FILTER (WHERE a.rejection_reason IS NOT NULL)<5 AND count(*)<10 FROM ch_annotation_attempts a
        WHERE a.job_id=p.job_id AND a.run_id=p.run_id AND a.retry_epoch=p.retry_epoch AND a.window_ordinal=p.window_ordinal)),
  counts(position,key,value) AS (
    SELECT 1,'jobs',count(*)::text FROM scope
    UNION ALL SELECT 2,'windows.one_answer',count(*)::text FROM attempts WHERE accepted_continuations=0
    UNION ALL SELECT 3,'windows.after_continuation',count(*)::text FROM attempts WHERE accepted_continuations>=1
    UNION ALL SELECT 4,'answers.continued',count(*)::text FROM attempts WHERE rejection_reason='annotation-partition-continued'
    UNION ALL SELECT 5,'answers.abandoned',((SELECT count(*) FROM attempts WHERE rejection_reason='annotation-partition-continued')
      -(SELECT coalesce(sum(accepted_continuations),0) FROM attempts)-(SELECT coalesce(sum(continuations),0) FROM open))::text
    UNION ALL SELECT 6,'answers.rejected',count(*)::text FROM attempts WHERE rejection_reason<>'annotation-partition-continued'
    UNION ALL SELECT 7,'answers.rejected.'||rejection_reason,count(*)::text FROM attempts WHERE rejection_reason<>'annotation-partition-continued' GROUP BY rejection_reason
    UNION ALL SELECT 8,'authorizations.no_outcome',count(*)::text FROM attempts WHERE rejection_reason IS NULL AND accepted_continuations IS NULL
    UNION ALL SELECT 9,'chains.open',count(*)::text FROM open
    UNION ALL SELECT 10,'chains.stale',count(*)::text FROM ch_annotation_partials p JOIN scope s ON p.job_id=s.id
      WHERE NOT EXISTS(SELECT 1 FROM open o WHERE (o.job_id,o.run_id,o.retry_epoch,o.window_ordinal)=(p.job_id,p.run_id,p.retry_epoch,p.window_ordinal))
    UNION ALL SELECT 11,'windows.reused',count(*)::text FROM ch_index_checkpoint_refs r JOIN scope s ON r.job_id=s.id AND r.run_id=s.run_id
      WHERE r.stage='Annotation' AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.job_id=r.job_id AND a.window_ordinal=r.window_ordinal)
    UNION ALL SELECT 12,'windows.legacy',count(*)::text FROM ch_index_checkpoints k JOIN scope s ON k.job_id=s.id AND k.run_id=s.run_id
      WHERE k.stage='Annotation' AND NOT EXISTS(SELECT 1 FROM ch_annotation_attempts a WHERE a.job_id=k.job_id AND a.run_id=k.run_id AND a.window_ordinal=k.window_ordinal AND a.accepted_continuations IS NOT NULL)
    UNION ALL SELECT 13,'answers',count(*)::text FROM attempts WHERE rejection_reason IS NOT NULL OR accepted_continuations IS NOT NULL
    UNION ALL SELECT 14,'r',coalesce(round((count(*) FILTER (WHERE rejection_reason<>'annotation-partition-continued'))::numeric
      /nullif(count(*) FILTER (WHERE rejection_reason IS NOT NULL OR accepted_continuations IS NOT NULL),0),4)::text,'none') FROM attempts)
SELECT 'ANNOTATION.'||key,value FROM counts ORDER BY position,key;
ROLLBACK;
\echo ANNOTATION.result|complete
