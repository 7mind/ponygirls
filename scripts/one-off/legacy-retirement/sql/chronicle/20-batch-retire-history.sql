\if :lr_more_history
\if :lr_apply
BEGIN;
\endif
-- --retire-history: the exact effect of the product's retirement (ReindexCohort.published): the derived rows of
-- the generation are deleted from the same five tables in the same order, then the row is marked retired. The
-- generation row survives as a tombstone, so a pinned read answers `indexed-view-retired`, not `not-found`.
DO $$
DECLARE
  ids uuid[];
BEGIN
  SELECT array_agg(d.id) INTO ids FROM (
    SELECT g.id FROM ch_generations g
    WHERE NOT g.retired AND (g.passage_format IS DISTINCT FROM 'ContextAwareProblems'
           OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy <> 'ContextAwareProblemsV1'))
      AND NOT EXISTS (SELECT 1 FROM ch_sources s WHERE s.published = g.id)
    ORDER BY g.id LIMIT current_setting('lr.batch_size')::int FOR UPDATE OF g) d;
  IF ids IS NULL THEN
    PERFORM set_config('lr.batch_n', '0', false);
    RETURN;
  END IF;
  DELETE FROM ch_chunks WHERE generation = ANY (ids);
  DELETE FROM ch_problem_spans WHERE generation = ANY (ids);
  DELETE FROM ch_problem_passages WHERE generation = ANY (ids);
  DELETE FROM ch_context_spans WHERE generation = ANY (ids);
  DELETE FROM ch_generation_tags WHERE generation = ANY (ids);
  UPDATE ch_generations SET retired = true WHERE id = ANY (ids) AND NOT retired;
  PERFORM set_config('lr.batch_n', cardinality(ids)::text, false);
END $$;
SELECT current_setting('lr.batch_n')::int AS lr_n, current_setting('lr.batch_n')::int >= :batch_size AS lr_more_history \gset
\echo LR.step.history_generations_retired|:lr_n
\if :lr_apply
COMMIT;
\endif
\endif
