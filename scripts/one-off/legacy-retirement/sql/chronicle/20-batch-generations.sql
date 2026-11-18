\if :lr_more_generations
\if :lr_apply
BEGIN;
\endif
-- Retired-format generations that no source publishes: tombstones of earlier rebuilds and superseded history.
-- Deleting the row cascades to its chunks, passages, spans, tags and search rows (as the product's purge does).
WITH doomed AS (
  SELECT g.id FROM ch_generations g
  WHERE (g.passage_format IS DISTINCT FROM 'ContextAwareProblems'
         OR g.profile IN (SELECT profile FROM ch_index_profiles WHERE policy <> 'ContextAwareProblemsV1'))
    AND NOT EXISTS (SELECT 1 FROM ch_sources s WHERE s.published = g.id)
  ORDER BY g.id LIMIT :batch_size FOR UPDATE OF g
), gone AS (
  DELETE FROM ch_generations g USING doomed d WHERE g.id = d.id RETURNING g.retired
)
SELECT count(*) AS lr_n, count(*) FILTER (WHERE NOT retired) AS lr_live, count(*) >= :batch_size AS lr_more_generations FROM gone \gset
\echo LR.step.generations_deleted|:lr_n
\echo LR.step.generations_deleted.not_retired|:lr_live
\if :lr_apply
COMMIT;
\endif
\endif
