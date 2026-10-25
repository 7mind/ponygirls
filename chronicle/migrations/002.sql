CREATE TABLE IF NOT EXISTS ch_schema_migrations(version integer PRIMARY KEY);
DROP INDEX IF EXISTS ch_chunks_fts;
CREATE TABLE IF NOT EXISTS ch_search_chunks(
  id uuid PRIMARY KEY REFERENCES ch_chunks(id) ON DELETE CASCADE,
  generation uuid NOT NULL REFERENCES ch_generations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES ch_sources(id),
  revision integer NOT NULL,
  profile text NOT NULL,
  document tsvector NOT NULL,
  embedding vector NOT NULL
);
CREATE INDEX IF NOT EXISTS ch_search_fts ON ch_search_chunks USING gin(document);
CREATE INDEX IF NOT EXISTS ch_search_session ON ch_search_chunks(session_id);
INSERT INTO ch_search_chunks(id,generation,session_id,revision,profile,document,embedding)
SELECT ch.id,ch.generation,s.id,g.revision,g.profile,ch.document,ch.embedding
FROM ch_sources s JOIN ch_generations g ON g.id=s.published JOIN ch_chunks ch ON ch.generation=g.id
WHERE NOT s.tombstone AND NOT EXISTS(SELECT 1 FROM ch_schema_migrations WHERE version=2)
ON CONFLICT(id) DO NOTHING;
INSERT INTO ch_schema_migrations VALUES(2) ON CONFLICT DO NOTHING;
