-- Rollback of generation lineage, migration 028 (docs/drafts/20261121-0055-ingest-limits-spec.md §5.6.4). Run by an
-- operator with the server stopped, before the release before it starts (and before down-027 when rolling back further).
-- A release before 028 refuses to start while a lineage generation (passage_format ContextAwareProblemsLineage) exists:
-- its migration 011 re-creates the format check without that value. This script flattens them, one transaction per
-- source that has one: a published lineage generation G gets the rows it holds of other generations relabeled to G
-- (passages, spans, pieces, chunks, Context spans, search rows with G's revision) and G's tags from its lineage's; every
-- other generation of G's lineage and every other lineage generation of the source is retired (a pin of it answers
-- indexed-view-retired, as after an explicit rebuild) and its remaining rows deleted; a staged lineage generation is
-- deleted with its rows (its job publishes again under the previous release); the source's generations are relabeled
-- ContextAwareProblems and its 028 rows deleted. A source without lineage generations is skipped, so an interrupted run
-- is completed by running the preflight and the apply again; a completed run leaves nothing to do (absent). Generations
-- of sources without lineage generations (roots, earlier releases' generations) hold their own rows and stay as they are.
-- While rows are relabeled the vector indexes of ch_search_chunks (whose updates would otherwise re-insert every
-- relabeled row) and the composite foreign keys of 008 are dropped; at the end the foreign keys are added again NOT
-- VALID, 011's and 022's checks restored, 028's tables, columns and index dropped and the vector indexes built again
-- (before the previous release's start would build one inside its start transaction).
--   psql -X -q -v ON_ERROR_STOP=1 [-v mode=preflight] -f chronicle/scripts/down-028-generation-lineage.sql    (read-only; prints the plan)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=dry-run -f …    (every change in one transaction, then ROLLBACK)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=apply -v apply_irreversible=yes -v confirm_database=<name> -v expect_plan=<token> -f …
-- Prints `DOWN028.<key>|<value>` lines; the last line is `DOWN028.result|<outcome>`. Any refusal happens before the
-- first change and exits 3. Apply commits each source's flattening on its own.
-- Tested by chronicle/server/src/test/scala/chronicle/GenerationLineageTest.scala.
\set ON_ERROR_STOP on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
\if :{?mode}
\else
\set mode preflight
\endif
\if :{?apply_irreversible}
\else
\set apply_irreversible no
\endif
\if :{?confirm_database}
\else
\set confirm_database ''
\endif
\if :{?expect_plan}
\else
\set expect_plan ''
\endif
SET search_path = pg_catalog, public;
SET statement_timeout = 0;
SET lock_timeout = '5s';
SELECT :'mode' IN ('preflight', 'dry-run', 'apply') AS d_known, :'mode' = 'preflight' AS d_preflight, :'mode' = 'apply' AS d_apply,
  to_regclass('public.ch_lineage_segments') IS NOT NULL AS d_present, current_database() AS d_database \gset
\if :d_known
\else
\echo DOWN028.result|refused-unknown-mode
DO $$ BEGIN RAISE EXCEPTION 'down-028 refused: mode is preflight, dry-run or apply'; END $$;
\endif
\echo DOWN028.database|:d_database
\if :d_present
\else
\echo DOWN028.result|absent
\quit
\endif
\if :d_apply
\else
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
\endif
-- What the generation (one of a lineage, by id) holds of other generations: its valid segment rows of other origins.
CREATE TEMP VIEW down028_held AS
  SELECT g.id AS generation, m.origin, m.kind, m.lo_major, m.lo, m.hi_major, m.hi
  FROM ch_generations g JOIN ch_lineage_segments m ON m.lineage = g.lineage AND m.since <= g.lineage_version AND (m.until IS NULL OR m.until > g.lineage_version)
  WHERE m.origin <> g.id;
SELECT
  (SELECT count(DISTINCT session_id) FROM ch_generations WHERE passage_format = 'ContextAwareProblemsLineage') AS d_sources,
  (SELECT count(*) FROM ch_generations g JOIN ch_sources s ON s.published = g.id WHERE g.passage_format = 'ContextAwareProblemsLineage') AS d_published,
  (SELECT count(*) FROM ch_generations g WHERE g.passage_format = 'ContextAwareProblemsLineage' AND EXISTS(SELECT 1 FROM ch_staged_generations st WHERE st.generation = g.id)) AS d_staged,
  (SELECT count(*) FROM ch_generations g WHERE g.passage_format = 'ContextAwareProblemsLineage' AND NOT EXISTS(SELECT 1 FROM ch_sources s WHERE s.published = g.id)
    AND NOT EXISTS(SELECT 1 FROM ch_staged_generations st WHERE st.generation = g.id)) AS d_unpublished,
  (SELECT count(*) FROM ch_sources s JOIN ch_generations p ON p.id = s.published AND p.passage_format = 'ContextAwareProblemsLineage' JOIN ch_generations g ON g.session_id = s.id
    AND g.id <> p.id AND NOT g.retired AND (g.lineage = p.lineage OR g.passage_format = 'ContextAwareProblemsLineage')
    AND NOT EXISTS(SELECT 1 FROM ch_staged_generations st WHERE st.generation = g.id)) AS d_retired,
  (SELECT count(*) FROM ch_sources s JOIN down028_held h ON h.generation = s.published AND h.kind = 'piece' JOIN ch_chunks ch ON ch.generation = h.origin AND ch.ordinal >= h.lo AND ch.ordinal < h.hi) AS d_chunks,
  (SELECT count(*) FROM ch_sources s JOIN down028_held h ON h.generation = s.published AND h.kind = 'piece' JOIN ch_chunks ch ON ch.generation = h.origin AND ch.ordinal >= h.lo AND ch.ordinal < h.hi
    JOIN ch_search_chunks sc ON sc.id = ch.id) AS d_search_rows,
  (SELECT count(*) FROM ch_sources s JOIN down028_held h ON h.generation = s.published AND h.kind = 'passage' JOIN ch_problem_passages p ON p.generation = h.origin AND p.ordinal >= h.lo AND p.ordinal < h.hi) AS d_passages,
  (SELECT count(*) FROM ch_lineage_segments) AS d_segments,
  (SELECT count(*) FROM ch_lineage_tags) AS d_tags,
  (SELECT count(*) FROM ch_generations WHERE lineage IS NOT NULL) AS d_lineage_generations,
  coalesce((SELECT string_agg(indexname, ',' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'ch_search_chunks' AND indexname ~ '^ch_search_hnsw_d[0-9]+$'), '') AS d_vector_indexes,
  to_regclass('public.ch_down028_vector_indexes') IS NOT NULL AS d_resumed \gset
-- The plan token binds the lineage generations of the sources to flatten and every count above.
SELECT md5(concat_ws('|', (SELECT string_agg(concat_ws(':', g.id, g.session_id, g.lineage, g.lineage_version, g.retired, s.published = g.id), ',' ORDER BY g.id)
    FROM ch_generations g LEFT JOIN ch_sources s ON s.id = g.session_id WHERE g.session_id IN (SELECT session_id FROM ch_generations WHERE passage_format = 'ContextAwareProblemsLineage')),
  :d_sources, :d_published, :d_staged, :d_unpublished, :d_retired, :d_chunks, :d_search_rows, :d_passages, :d_segments, :d_tags, :d_lineage_generations, :'d_vector_indexes', :'d_resumed')) AS d_plan \gset
\echo DOWN028.sources|:d_sources
\echo DOWN028.lineage.published|:d_published
\echo DOWN028.lineage.staged|:d_staged
\echo DOWN028.lineage.unpublished|:d_unpublished
\echo DOWN028.retired.generations|:d_retired
\echo DOWN028.relabeled.chunks|:d_chunks
\echo DOWN028.relabeled.search_rows|:d_search_rows
\echo DOWN028.relabeled.passages|:d_passages
\echo DOWN028.segments|:d_segments
\echo DOWN028.lineage_tags|:d_tags
\echo DOWN028.lineage_generations|:d_lineage_generations
\echo DOWN028.vector_indexes|:d_vector_indexes
\echo DOWN028.resumed|:d_resumed
\echo DOWN028.plan|:d_plan
\if :d_preflight
ROLLBACK;
\echo DOWN028.result|preflight-complete
\quit
\endif
\if :d_apply
SELECT :'apply_irreversible' = 'yes' AND :'confirm_database' = current_database() AND :'expect_plan' = :'d_plan' AS d_confirmed \gset
\if :d_confirmed
\else
\echo DOWN028.result|refused-unconfirmed
DO $$ BEGIN RAISE EXCEPTION 'down-028 refused before any change: apply needs apply_irreversible=yes, confirm_database=<this database> and expect_plan=<the preflight plan>'; END $$;
\endif
SET chronicle.down028_commit = 'on';
\else
SET LOCAL chronicle.down028_commit = 'off';
\endif
-- Before any row is relabeled: the vector indexes' definitions are kept (a resumed run builds them from these) and the
-- indexes and the composite foreign keys dropped.
SELECT :d_sources > 0 AS d_flatten \gset
\if :d_flatten
CREATE TABLE IF NOT EXISTS public.ch_down028_vector_indexes(name text PRIMARY KEY, definition text NOT NULL);
INSERT INTO public.ch_down028_vector_indexes(name, definition) SELECT indexname, indexdef FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'ch_search_chunks' AND indexname ~ '^ch_search_hnsw_d[0-9]+$' ON CONFLICT (name) DO NOTHING;
DO $$ DECLARE index_name text; BEGIN
  FOR index_name IN SELECT name FROM public.ch_down028_vector_indexes ORDER BY name LOOP EXECUTE format('DROP INDEX IF EXISTS public.%I', index_name); END LOOP;
END $$;
ALTER TABLE ch_problem_spans DROP CONSTRAINT IF EXISTS ch_problem_spans_generation_passage_id_fkey;
ALTER TABLE ch_problem_pieces DROP CONSTRAINT IF EXISTS ch_problem_pieces_generation_chunk_id_fkey;
ALTER TABLE ch_problem_pieces DROP CONSTRAINT IF EXISTS ch_problem_pieces_generation_passage_ordinal_fkey;
\endif
DO $$
DECLARE
  commit_each boolean := current_setting('chronicle.down028_commit') = 'on';
  v_source uuid; v_published uuid; v_lineage uuid; v_version integer; v_revision integer;
BEGIN
  FOR v_source IN SELECT DISTINCT session_id FROM ch_generations WHERE passage_format = 'ContextAwareProblemsLineage' ORDER BY session_id LOOP
    v_published := NULL; v_lineage := NULL;
    SELECT g.id, g.lineage, g.lineage_version, g.revision INTO v_published, v_lineage, v_version, v_revision
      FROM ch_sources s JOIN ch_generations g ON g.id = s.published AND g.passage_format = 'ContextAwareProblemsLineage' WHERE s.id = v_source;
    IF v_published IS NOT NULL THEN
      -- Spans first: a span's place is (its passage's ordinal in its origin, its ordinal).
      UPDATE ch_problem_spans sp SET generation = v_published FROM down028_held h, ch_problem_passages p
        WHERE h.generation = v_published AND h.kind = 'span' AND sp.generation = h.origin AND p.generation = h.origin AND p.id = sp.passage_id
          AND (p.ordinal, sp.ordinal) >= (h.lo_major, h.lo) AND (p.ordinal, sp.ordinal) < (h.hi_major, h.hi);
      UPDATE ch_problem_passages p SET generation = v_published FROM down028_held h
        WHERE h.generation = v_published AND h.kind = 'passage' AND p.generation = h.origin AND p.ordinal >= h.lo AND p.ordinal < h.hi;
      UPDATE ch_problem_pieces pc SET generation = v_published FROM down028_held h
        WHERE h.generation = v_published AND h.kind = 'piece' AND pc.generation = h.origin AND pc.piece_ordinal >= h.lo AND pc.piece_ordinal < h.hi;
      UPDATE ch_chunks ch SET generation = v_published FROM down028_held h
        WHERE h.generation = v_published AND h.kind = 'piece' AND ch.generation = h.origin AND ch.ordinal >= h.lo AND ch.ordinal < h.hi;
      UPDATE ch_context_spans x SET generation = v_published FROM down028_held h
        WHERE h.generation = v_published AND h.kind = 'context' AND x.generation = h.origin AND x.ordinal >= h.lo AND x.ordinal < h.hi;
      UPDATE ch_search_chunks sc SET generation = v_published, revision = v_revision FROM ch_chunks ch
        WHERE ch.generation = v_published AND sc.id = ch.id AND (sc.generation <> v_published OR sc.revision <> v_revision);
      DELETE FROM ch_generation_tags WHERE generation = v_published;
      INSERT INTO ch_generation_tags(generation, tag) SELECT v_published, tag FROM ch_lineage_tags WHERE lineage = v_lineage;
    END IF;
    -- Retired: every other generation of the published one's lineage (the rows it held of them are its own now) and
    -- every other lineage generation of the source; deleted: its staged lineage generations. Their remaining rows go.
    CREATE TEMP TABLE down028_gone ON COMMIT DROP AS
      SELECT g.id, EXISTS(SELECT 1 FROM ch_staged_generations st WHERE st.generation = g.id) AS staged FROM ch_generations g
      WHERE g.session_id = v_source AND g.id IS DISTINCT FROM v_published
        AND ((v_lineage IS NOT NULL AND g.lineage = v_lineage) OR g.passage_format = 'ContextAwareProblemsLineage');
    UPDATE ch_generations g SET retired = true FROM down028_gone x WHERE x.id = g.id AND NOT x.staged AND NOT g.retired;
    DELETE FROM ch_problem_pieces t USING down028_gone x WHERE t.generation = x.id;
    DELETE FROM ch_chunks t USING down028_gone x WHERE t.generation = x.id;
    DELETE FROM ch_problem_spans t USING down028_gone x WHERE t.generation = x.id;
    DELETE FROM ch_problem_passages t USING down028_gone x WHERE t.generation = x.id;
    DELETE FROM ch_context_spans t USING down028_gone x WHERE t.generation = x.id;
    DELETE FROM ch_generation_tags t USING down028_gone x WHERE t.generation = x.id;
    DELETE FROM ch_generation_retirements t USING down028_gone x WHERE t.generation = x.id;
    DELETE FROM ch_generations g USING down028_gone x WHERE x.id = g.id AND x.staged;
    DROP TABLE down028_gone;
    -- The source's 028 rows, then its generations as an earlier release stores them.
    DELETE FROM ch_search_retirements WHERE session_id = v_source;
    DELETE FROM ch_lineage_retirements r USING ch_generations g WHERE g.id = r.lineage AND g.session_id = v_source;
    DELETE FROM ch_lineage_tags t USING ch_generations g WHERE g.id = t.lineage AND g.session_id = v_source;
    DELETE FROM ch_lineage_tag_deltas t USING ch_generations g WHERE g.id = t.generation AND g.session_id = v_source;
    DELETE FROM ch_lineage_segments m USING ch_generations g WHERE g.id = m.lineage AND g.session_id = v_source;
    DELETE FROM ch_generation_lineage l USING ch_generations g WHERE g.id = l.generation AND g.session_id = v_source;
    UPDATE ch_generations SET passage_format = 'ContextAwareProblems', lineage = NULL, lineage_version = NULL
      WHERE session_id = v_source AND (passage_format = 'ContextAwareProblemsLineage' OR lineage IS NOT NULL);
    RAISE NOTICE 'down-028 flattened source %', v_source;
    IF commit_each THEN COMMIT; END IF;
  END LOOP;
END $$;
\if :d_apply
BEGIN;
\endif
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid = 'ch_problem_spans'::regclass AND conname = 'ch_problem_spans_generation_passage_id_fkey') THEN
    ALTER TABLE ch_problem_spans ADD CONSTRAINT ch_problem_spans_generation_passage_id_fkey FOREIGN KEY(generation, passage_id) REFERENCES ch_problem_passages(generation, id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid = 'ch_problem_pieces'::regclass AND conname = 'ch_problem_pieces_generation_chunk_id_fkey') THEN
    ALTER TABLE ch_problem_pieces ADD CONSTRAINT ch_problem_pieces_generation_chunk_id_fkey FOREIGN KEY(generation, chunk_id) REFERENCES ch_chunks(generation, id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid = 'ch_problem_pieces'::regclass AND conname = 'ch_problem_pieces_generation_passage_ordinal_fkey') THEN
    ALTER TABLE ch_problem_pieces ADD CONSTRAINT ch_problem_pieces_generation_passage_ordinal_fkey FOREIGN KEY(generation, passage_ordinal) REFERENCES ch_problem_passages(generation, ordinal) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE ch_generations DROP CONSTRAINT IF EXISTS ch_generations_current_format_check;
ALTER TABLE ch_generations ADD CONSTRAINT ch_generations_current_format_check CHECK(retired OR (passage_format IS NOT NULL AND passage_format='ContextAwareProblems'));
ALTER TABLE ch_generations DROP CONSTRAINT IF EXISTS ch_generations_passage_format_check;
ALTER TABLE ch_generations ADD CONSTRAINT ch_generations_passage_format_check CHECK(passage_format IN ('LegacyAnnotations','ContiguousProblems','ContextAwareProblems'));
DROP VIEW IF EXISTS pg_temp.down028_held;
DROP TABLE ch_lineage_segments, ch_generation_lineage, ch_lineage_tags, ch_lineage_tag_deltas, ch_lineage_retirements, ch_search_retirements;
DROP INDEX IF EXISTS ch_generations_lineage_version;
DROP INDEX IF EXISTS ch_generations_run;
DROP INDEX IF EXISTS ch_index_checkpoint_refs_referrer;
ALTER TABLE ch_generations DROP COLUMN IF EXISTS lineage, DROP COLUMN IF EXISTS lineage_version;
ALTER TABLE ch_search_chunks DROP COLUMN IF EXISTS ordinal;
DELETE FROM ch_schema_migrations WHERE version = 28;
DO $$ DECLARE index_definition text; BEGIN
  IF to_regclass('public.ch_down028_vector_indexes') IS NOT NULL THEN
    FOR index_definition IN SELECT replace(definition, 'CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ') FROM public.ch_down028_vector_indexes ORDER BY name LOOP EXECUTE index_definition; END LOOP;
    DROP TABLE public.ch_down028_vector_indexes;
  END IF;
END $$;
\if :d_apply
COMMIT;
\echo DOWN028.result|applied
\else
ROLLBACK;
\echo DOWN028.result|dry-run-complete
\endif
