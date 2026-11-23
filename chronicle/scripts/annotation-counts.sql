-- How the windows of a set of indexing jobs were annotated (R-g part 2, ANNOT2; docs/operations.md "Migration 031"), in
-- each job's current run and retry epoch. Read-only; the tables have no timestamps, so a caller scopes by job set.
--   psql -X -q -v ON_ERROR_STOP=1 -v jobs=<uuid>[,<uuid>...] -f chronicle/scripts/annotation-counts.sql
-- Prints `ANNOTATION.<key>|<count>` lines (ids and counts only; reasons are the stored reason codes), then
-- `ANNOTATION.result|complete`:
--   windows.one_answer / windows.after_continuation: windows accepted in one answer / after kept answers;
--   answers.continued: kept answers (reason annotation-partition-continued), of which answers.abandoned are neither in an
--     accepted window nor in an open chain; answers.rejected (and per reason): other non-final answers;
--   authorizations.no_outcome: authorizations without an answer (cancelled, crashed, transport failures);
--   chains.open, chains.invalid_or_inactive, chains.stale: the job set's partial rows, each in exactly one of them.
--     A row is loaded by the next claim when it is of the job's current run and epoch, the job is Queued or Running at its
--     source's head revision under its owner's target profile, its window is neither accepted nor referenced, and its
--     window's ledger is not exhausted; the other rows are stale (never read). A loaded row is open when it passes every
--     check of the loader the database can evaluate, else invalid_or_inactive (the loader discards it): format, profile,
--     coverage and continuation ranges (V1, V2, V6); provenance (V10): the window's ledger rows all carry the row's input
--     hash, the row's attempt is at most their count, the window's active chain is the row's chain, the chain's kept rows
--     are exactly `continuations`, the latest is the row's attempt and carries the row's kept hash, every kept row carries
--     a hash, at most 3 non-final answers precede it, and the stops increase from 1 and are part ends (k,0) of the kept
--     parts. Not evaluated here (they need the window's source, the incoming carry or the product's canonical JSON hash):
--     the content hash (V3), the kept hash recomputed from the kept parts and the hashes of the prefixes before the last
--     stop (V4, V10), the window's fragment count (V5), the kept decision's validity against the window and the request
--     bound of its rest (V7-V9), and a changed window input (the loader then fails the job annotation-input-changed).
--     Rows the product wrote pass those by construction: on unaltered data open counts what the loader resumes.
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
WITH scope AS (SELECT j.id,j.run_id,j.annotation_retry_epoch AS epoch,j.state,j.revision,j.session_id,j.profile FROM ch_jobs j
    WHERE j.id = ANY(string_to_array(:'jobs', ',')::uuid[])),
  attempts AS (SELECT a.* FROM ch_annotation_attempts a JOIN scope s ON a.job_id=s.id AND a.run_id=s.run_id AND a.retry_epoch=s.epoch),
  loaded AS (SELECT p.*,s.profile AS job_profile FROM ch_annotation_partials p JOIN scope s ON p.job_id=s.id AND p.run_id=s.run_id AND p.retry_epoch=s.epoch
    JOIN ch_sources src ON src.id=s.session_id AND NOT src.tombstone AND src.revision=s.revision
    WHERE s.state IN ('Queued','Running') AND EXISTS(SELECT 1 FROM ch_owner_targets t WHERE t.owner=src.owner AND t.profile=s.profile)
      AND NOT EXISTS(SELECT 1 FROM ch_index_checkpoints k WHERE k.job_id=p.job_id AND k.run_id=p.run_id AND k.stage='Annotation' AND k.window_ordinal=p.window_ordinal)
      AND NOT EXISTS(SELECT 1 FROM ch_index_checkpoint_refs r WHERE r.job_id=p.job_id AND r.run_id=p.run_id AND r.stage='Annotation' AND r.window_ordinal=p.window_ordinal)
      AND (SELECT count(*) FILTER (WHERE a.rejection_reason IS NOT NULL)<5 AND count(*)<10 FROM attempts a
        WHERE a.job_id=p.job_id AND a.window_ordinal=p.window_ordinal)),
  open AS (SELECT p.* FROM loaded p
    WHERE p.format='annotation-partial-v1' AND p.profile=p.job_profile
      AND p.window_fragments BETWEEN 2 AND 64 AND p.covered_fragments BETWEEN 1 AND p.window_fragments-1 AND p.continuations BETWEEN 1 AND 4
      AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.job_id=p.job_id AND a.window_ordinal=p.window_ordinal AND a.input_hash<>p.input_hash)
      AND p.attempt<=(SELECT count(*) FROM attempts a WHERE a.job_id=p.job_id AND a.window_ordinal=p.window_ordinal)
      AND EXISTS(SELECT 1 FROM ch_annotation_active_chains m WHERE (m.job_id,m.run_id,m.retry_epoch,m.window_ordinal)=(p.job_id,p.run_id,p.retry_epoch,p.window_ordinal)
        AND m.active_chain=p.chain_id)
      AND (SELECT count(*)=p.continuations AND max(a.attempt)=p.attempt AND bool_and(a.continued_kept_hash IS NOT NULL)
          AND bool_or(a.attempt=p.attempt AND a.continued_kept_hash=p.kept_hash)
        FROM attempts a WHERE a.job_id=p.job_id AND a.window_ordinal=p.window_ordinal AND a.rejection_reason='annotation-partition-continued' AND a.chain_id=p.chain_id)
      AND (SELECT count(*) FROM attempts a WHERE a.job_id=p.job_id AND a.window_ordinal=p.window_ordinal AND a.rejection_reason IS NOT NULL AND a.attempt<p.attempt)<=3
      AND CASE WHEN array_ndims(p.stops)=1 AND array_lower(p.stops,1)=1 AND cardinality(p.stops)=p.continuations THEN
        p.stops[1]>=1 AND p.stops[cardinality(p.stops)]=p.covered_fragments
        AND NOT EXISTS(SELECT 1 FROM generate_subscripts(p.stops,1) i WHERE p.stops[i] IS NULL OR (i>1 AND p.stops[i]<=p.stops[i-1])
          OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.kept->'parts')='array' THEN p.kept->'parts' ELSE '[]'::jsonb END) part
            WHERE part->'end'->'fragmentIndex'=to_jsonb(p.stops[i]) AND part->'end'->'scalarOffset'='0'::jsonb))
        ELSE false END),
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
    UNION ALL SELECT 10,'chains.invalid_or_inactive',count(*)::text FROM loaded p
      WHERE NOT EXISTS(SELECT 1 FROM open o WHERE (o.job_id,o.run_id,o.retry_epoch,o.window_ordinal)=(p.job_id,p.run_id,p.retry_epoch,p.window_ordinal))
    UNION ALL SELECT 11,'chains.stale',count(*)::text FROM ch_annotation_partials p JOIN scope s ON p.job_id=s.id
      WHERE NOT EXISTS(SELECT 1 FROM loaded l WHERE (l.job_id,l.run_id,l.retry_epoch,l.window_ordinal)=(p.job_id,p.run_id,p.retry_epoch,p.window_ordinal))
    UNION ALL SELECT 12,'windows.reused',count(*)::text FROM ch_index_checkpoint_refs r JOIN scope s ON r.job_id=s.id AND r.run_id=s.run_id
      WHERE r.stage='Annotation' AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.job_id=r.job_id AND a.window_ordinal=r.window_ordinal)
    UNION ALL SELECT 13,'windows.legacy',count(*)::text FROM ch_index_checkpoints k JOIN scope s ON k.job_id=s.id AND k.run_id=s.run_id
      WHERE k.stage='Annotation' AND NOT EXISTS(SELECT 1 FROM ch_annotation_attempts a WHERE a.job_id=k.job_id AND a.run_id=k.run_id AND a.window_ordinal=k.window_ordinal AND a.accepted_continuations IS NOT NULL)
    UNION ALL SELECT 14,'answers',count(*)::text FROM attempts WHERE rejection_reason IS NOT NULL OR accepted_continuations IS NOT NULL
    UNION ALL SELECT 15,'r',coalesce(round((count(*) FILTER (WHERE rejection_reason<>'annotation-partition-continued'))::numeric
      /nullif(count(*) FILTER (WHERE rejection_reason IS NOT NULL OR accepted_continuations IS NOT NULL),0),4)::text,'none') FROM attempts)
SELECT 'ANNOTATION.'||key,value FROM counts ORDER BY position,key;
ROLLBACK;
\echo ANNOTATION.result|complete
