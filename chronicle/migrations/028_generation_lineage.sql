-- Generation lineage, I3 (docs/drafts/20261121-0055-ingest-limits-spec.md §5.6): rows stay labeled with the generation
-- that wrote them (their origin) and are never rewritten; which rows a generation holds is stored as versioned segment
-- rows. A lineage starts at a full publication (a root, version 0, lineage = its own id) and continues with
-- incremental publications (versions 1, 2, …, assigned at their switch, labeled ContextAwareProblemsLineage). The
-- generation (lineage, v) holds, for every segment row with since <= v < until (until NULL: open), the rows of `origin`
-- of that kind inside [lo, hi) (spans: [(lo_major, lo), (hi_major, hi)) by (passage ordinal, span ordinal)). A segment
-- row whose `since` is NULL was written by a staged generation (`staged_by`) and is invisible. A generation without a
-- lineage (an earlier release's) holds its own rows.
-- ch_generation_lineage: per generation its parent, the cut it continues from and its piece count (pages count by it).
-- ch_lineage_tags: the tag multiset (pieces per tag) of a lineage's published version; ch_lineage_tag_deltas: an
-- incremental generation's staged changes of it; ch_lineage_retirements: a superseded lineage whose generations' search
-- rows and tag rows are deleted after the switch. ch_search_chunks.ordinal is the piece ordinal (NULL for rows of earlier
-- releases), the generation-independent ranking tie-break; ch_search_retirements: superseded ranges of an origin's
-- search rows still being deleted. The format check admits the lineage label (pre-028 releases re-create their own
-- passage_format check at start, which fails while a lineage generation exists: they refuse to start).
-- Runs at every start; idempotent; DDL only. Rollback: chronicle/scripts/down-028-generation-lineage.sql.
ALTER TABLE ch_generations ADD COLUMN IF NOT EXISTS lineage uuid;
ALTER TABLE ch_generations ADD COLUMN IF NOT EXISTS lineage_version integer CHECK(lineage_version>=0);
-- A version is taken once: the lineage is linear.
CREATE UNIQUE INDEX IF NOT EXISTS ch_generations_lineage_version ON ch_generations(lineage,lineage_version);
CREATE TABLE IF NOT EXISTS ch_lineage_segments(
  lineage uuid NOT NULL REFERENCES ch_generations(id) ON DELETE CASCADE,
  origin uuid NOT NULL REFERENCES ch_generations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN('piece','passage','span','context')),
  since integer CHECK(since>=0),
  until integer,
  lo_major integer NOT NULL,
  lo bigint NOT NULL,
  hi_major integer NOT NULL,
  hi bigint NOT NULL,
  staged_by uuid,
  CHECK(until IS NULL OR until>since),
  CHECK((lo_major,lo)<(hi_major,hi)));
CREATE INDEX IF NOT EXISTS ch_lineage_segments_probe ON ch_lineage_segments(lineage,origin,kind,since);
CREATE TABLE IF NOT EXISTS ch_generation_lineage(
  generation uuid PRIMARY KEY REFERENCES ch_generations(id) ON DELETE CASCADE,
  parent uuid,
  last_window integer,
  cut jsonb,
  pieces bigint NOT NULL CHECK(pieces>=0));
CREATE TABLE IF NOT EXISTS ch_lineage_tags(
  lineage uuid NOT NULL REFERENCES ch_generations(id) ON DELETE CASCADE,
  tag text COLLATE "pg_unicode_fast" NOT NULL,
  pieces bigint NOT NULL CHECK(pieces>0),
  PRIMARY KEY(lineage,tag));
CREATE TABLE IF NOT EXISTS ch_lineage_tag_deltas(
  generation uuid NOT NULL REFERENCES ch_generations(id) ON DELETE CASCADE,
  tag text COLLATE "pg_unicode_fast" NOT NULL,
  delta bigint NOT NULL,
  PRIMARY KEY(generation,tag));
CREATE TABLE IF NOT EXISTS ch_lineage_retirements(
  lineage uuid PRIMARY KEY REFERENCES ch_generations(id) ON DELETE CASCADE);
ALTER TABLE ch_search_chunks ADD COLUMN IF NOT EXISTS ordinal integer;
CREATE TABLE IF NOT EXISTS ch_search_retirements(
  session_id uuid NOT NULL,
  origin uuid NOT NULL REFERENCES ch_generations(id) ON DELETE CASCADE,
  piece_lo integer NOT NULL,
  piece_hi integer NOT NULL,
  CHECK(piece_lo<piece_hi),
  PRIMARY KEY(origin,piece_lo));
-- 022's check admits the lineage label; redefined only while its definition lacks it (its scan of ch_generations under
-- ACCESS EXCLUSIVE happens once).
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='ch_generations'::regclass AND conname='ch_generations_current_format_check' AND pg_get_constraintdef(oid) LIKE '%ContextAwareProblemsLineage%') THEN
    ALTER TABLE ch_generations DROP CONSTRAINT IF EXISTS ch_generations_current_format_check;
    ALTER TABLE ch_generations ADD CONSTRAINT ch_generations_current_format_check
      CHECK(retired OR (passage_format IS NOT NULL AND passage_format IN ('ContextAwareProblems','ContextAwareProblemsLineage')));
  END IF;
END $$;
-- down-028 drops 008's composite foreign keys while it relabels rows and adds them again (NOT VALID) at its end: a start
-- after an interrupted run adds them again.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='ch_problem_spans'::regclass AND conname='ch_problem_spans_generation_passage_id_fkey') THEN
    ALTER TABLE ch_problem_spans ADD CONSTRAINT ch_problem_spans_generation_passage_id_fkey FOREIGN KEY(generation,passage_id) REFERENCES ch_problem_passages(generation,id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='ch_problem_pieces'::regclass AND conname='ch_problem_pieces_generation_chunk_id_fkey') THEN
    ALTER TABLE ch_problem_pieces ADD CONSTRAINT ch_problem_pieces_generation_chunk_id_fkey FOREIGN KEY(generation,chunk_id) REFERENCES ch_chunks(generation,id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='ch_problem_pieces'::regclass AND conname='ch_problem_pieces_generation_passage_ordinal_fkey') THEN
    ALTER TABLE ch_problem_pieces ADD CONSTRAINT ch_problem_pieces_generation_passage_ordinal_fkey FOREIGN KEY(generation,passage_ordinal) REFERENCES ch_problem_passages(generation,ordinal) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
INSERT INTO ch_schema_migrations VALUES(28) ON CONFLICT DO NOTHING;
