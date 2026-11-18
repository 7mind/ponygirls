\if :lr_more_published
\if :lr_apply
BEGIN;
\endif
-- --retire-published (owner decision Q106): a PUBLISHED generation in a retired output format, retired the way the
-- product retires a generation (ReindexCohort.published: the five derived tables, then retired = true; the row stays
-- as a tombstone, so a pinned read answers `indexed-view-retired`), and unpublished: the source's publication pointer
-- is cleared and its search rows (which only ever hold the published generation, PostgresArchive.publish) are
-- removed. The source is then in the product's never-indexed state: transcript and messages readable, no chunks,
-- passages Unindexed, no search hits, until the owner re-indexes it. Sessions, revisions, messages and jobs stay.
DO $$
DECLARE
  generations uuid[];
  sources uuid[];
  n bigint;
BEGIN
  SELECT array_agg(d.generation), array_agg(d.source) INTO generations, sources FROM (
    SELECT g.id AS generation, s.id AS source FROM ch_sources s JOIN ch_generations g ON g.id = s.published
    WHERE NOT g.retired AND (g.passage_format IS DISTINCT FROM 'ContextAwareProblems'
           OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy IS DISTINCT FROM 'ContextAwareProblemsV1'))
    ORDER BY g.id LIMIT current_setting('lr.batch_size')::int FOR UPDATE OF s, g) d;
  IF generations IS NULL THEN
    PERFORM set_config('lr.batch_n', '0', false); PERFORM set_config('lr.batch_unpublished', '0', false); PERFORM set_config('lr.batch_search', '0', false);
    RETURN;
  END IF;
  UPDATE ch_sources SET published = NULL WHERE id = ANY (sources) AND published = ANY (generations);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> cardinality(generations) THEN
    RAISE EXCEPTION 'legacy-retirement refused: % of % selected sources were unpublished; the publication changed under the lock', n, cardinality(generations);
  END IF;
  PERFORM set_config('lr.batch_unpublished', n::text, false);
  DELETE FROM ch_search_chunks WHERE session_id = ANY (sources) AND generation = ANY (generations);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('lr.batch_search', n::text, false);
  DELETE FROM ch_chunks WHERE generation = ANY (generations);
  DELETE FROM ch_problem_spans WHERE generation = ANY (generations);
  DELETE FROM ch_problem_passages WHERE generation = ANY (generations);
  DELETE FROM ch_context_spans WHERE generation = ANY (generations);
  DELETE FROM ch_generation_tags WHERE generation = ANY (generations);
  UPDATE ch_generations SET retired = true WHERE id = ANY (generations) AND NOT retired;
  PERFORM set_config('lr.batch_n', cardinality(generations)::text, false);
END $$;
SELECT current_setting('lr.batch_n')::int AS lr_n, current_setting('lr.batch_unpublished')::int AS lr_u,
       current_setting('lr.batch_search')::int AS lr_sr, current_setting('lr.batch_n')::int >= :batch_size AS lr_more_published \gset
\echo LR.step.published_generations_retired|:lr_n
\echo LR.step.published_sources_unindexed|:lr_u
\echo LR.step.published_search_rows_deleted|:lr_sr
\if :lr_apply
COMMIT;
\endif
\endif
