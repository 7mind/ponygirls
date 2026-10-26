CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS ch_revision_info(
  session_id uuid NOT NULL,
  revision integer NOT NULL,
  metadata jsonb NOT NULL,
  source jsonb NOT NULL,
  completion text NOT NULL,
  redacted boolean NOT NULL,
  last_timestamp text,
  last_timestamp_order numeric,
  message_count integer NOT NULL,
  lexical_version integer NOT NULL DEFAULT 0,
  PRIMARY KEY(session_id,revision),
  FOREIGN KEY(session_id,revision) REFERENCES ch_revisions(session_id,revision) ON DELETE CASCADE
);
ALTER TABLE ch_revision_info ADD COLUMN IF NOT EXISTS lexical_version integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ch_revision_info_timestamp ON ch_revision_info(last_timestamp_order,session_id);
CREATE TABLE IF NOT EXISTS ch_messages(
  session_id uuid NOT NULL,
  revision integer NOT NULL,
  position integer NOT NULL,
  message_id text NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY(session_id,revision,position),
  UNIQUE(session_id,revision,message_id),
  FOREIGN KEY(session_id,revision) REFERENCES ch_revisions(session_id,revision) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ch_archive_fragments(
  session_id uuid NOT NULL,
  revision integer NOT NULL,
  ordinal integer NOT NULL,
  value text COLLATE "pg_unicode_fast" NOT NULL,
  PRIMARY KEY(session_id,revision,ordinal),
  FOREIGN KEY(session_id,revision) REFERENCES ch_revisions(session_id,revision) ON DELETE CASCADE
);
DROP INDEX IF EXISTS ch_archive_fragments_trgm;
CREATE INDEX IF NOT EXISTS ch_archive_fragments_lower_trgm ON ch_archive_fragments USING gin((lower(value COLLATE pg_unicode_fast)) gin_trgm_ops);
CREATE TABLE IF NOT EXISTS ch_generation_tags(
  generation uuid NOT NULL REFERENCES ch_generations(id) ON DELETE CASCADE,
  tag text COLLATE "pg_unicode_fast" NOT NULL,
  PRIMARY KEY(generation,tag)
);
INSERT INTO ch_generation_tags(generation,tag)
SELECT DISTINCT ch.generation,jsonb_array_elements_text(ch.value->'tags')
FROM ch_chunks ch WHERE NOT EXISTS(SELECT 1 FROM ch_schema_migrations WHERE version=6)
ON CONFLICT DO NOTHING;
