CREATE OR REPLACE FUNCTION ch_refresh_archive_head_candidates() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ch_archive_fragments SET head_candidate=true
  WHERE session_id=NEW.id AND revision=NEW.revision AND NOT head_candidate;

  -- Historical rebuilds may remain candidates; skipping locked rows must never delay or narrow the new HEAD.
  WITH obsolete AS MATERIALIZED(
    SELECT ctid FROM ch_archive_fragments
    WHERE session_id=NEW.id AND revision<>NEW.revision AND head_candidate
    FOR UPDATE SKIP LOCKED
  )
  UPDATE ch_archive_fragments fragment SET head_candidate=false
  FROM obsolete WHERE fragment.ctid=obsolete.ctid;
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ch_schema_migrations WHERE version=17) THEN
    LOCK TABLE ch_users,ch_sources,ch_revisions,ch_archive_fragments IN ACCESS EXCLUSIVE MODE;
    DROP INDEX IF EXISTS ch_archive_fragments_lower_trgm;
    ALTER TABLE ch_archive_fragments ADD COLUMN IF NOT EXISTS head_candidate boolean NOT NULL DEFAULT false;
    UPDATE ch_archive_fragments fragment SET head_candidate=(fragment.revision=source.revision)
    FROM ch_sources source WHERE fragment.session_id=source.id
      AND fragment.head_candidate IS DISTINCT FROM (fragment.revision=source.revision);
    ALTER TABLE ch_archive_fragments ALTER COLUMN head_candidate SET DEFAULT true;
    CREATE OR REPLACE TRIGGER ch_archive_head_candidates AFTER UPDATE OF revision ON ch_sources
    FOR EACH ROW EXECUTE FUNCTION ch_refresh_archive_head_candidates();
    CREATE INDEX ch_archive_fragments_lower_trgm ON ch_archive_fragments USING gin(value gin_trgm_ops) WHERE head_candidate;
    ANALYZE ch_archive_fragments;
    INSERT INTO ch_schema_migrations(version) VALUES(17);
  END IF;
END;
$$;

UPDATE ch_sources source SET revision=source.revision
WHERE EXISTS(SELECT 1 FROM ch_archive_fragments fragment
  WHERE fragment.session_id=source.id AND fragment.revision<>source.revision AND fragment.head_candidate);
CREATE INDEX IF NOT EXISTS ch_archive_fragments_lower_trgm ON ch_archive_fragments USING gin(value gin_trgm_ops) WHERE head_candidate;
