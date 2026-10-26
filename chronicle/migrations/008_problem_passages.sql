ALTER TABLE ch_generations ADD COLUMN IF NOT EXISTS passage_format text CHECK(passage_format IN ('LegacyAnnotations','ContiguousProblems'));
ALTER TABLE ch_generations ADD COLUMN IF NOT EXISTS passage_count bigint NOT NULL DEFAULT 0 CHECK(passage_count>=0);
CREATE TABLE IF NOT EXISTS ch_problem_passages(
  generation uuid NOT NULL REFERENCES ch_generations(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal>=0),
  initial_summary text NOT NULL,
  value jsonb NOT NULL,
  span_count bigint NOT NULL CHECK(span_count>0),
  PRIMARY KEY(generation,id),
  UNIQUE(generation,ordinal)
);
CREATE TABLE IF NOT EXISTS ch_problem_spans(
  generation uuid NOT NULL,
  passage_id uuid NOT NULL,
  ordinal bigint NOT NULL CHECK(ordinal>=0),
  message_id text NOT NULL,
  message_position integer NOT NULL CHECK(message_position>=0),
  start_byte integer NOT NULL CHECK(start_byte>=0),
  end_byte integer NOT NULL CHECK(end_byte>start_byte),
  PRIMARY KEY(generation,passage_id,ordinal),
  FOREIGN KEY(generation,passage_id) REFERENCES ch_problem_passages(generation,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ch_chunks_generation_identity ON ch_chunks(generation,id);
CREATE TABLE IF NOT EXISTS ch_problem_pieces(
  generation uuid NOT NULL,
  chunk_id uuid NOT NULL,
  passage_ordinal integer NOT NULL,
  piece_ordinal integer NOT NULL CHECK(piece_ordinal>=0),
  PRIMARY KEY(generation,chunk_id),
  UNIQUE(generation,piece_ordinal),
  FOREIGN KEY(generation,chunk_id) REFERENCES ch_chunks(generation,id) ON DELETE CASCADE,
  FOREIGN KEY(generation,passage_ordinal) REFERENCES ch_problem_passages(generation,ordinal) ON DELETE CASCADE
);
INSERT INTO ch_schema_migrations VALUES(8) ON CONFLICT DO NOTHING;
