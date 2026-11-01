DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ch_schema_migrations WHERE version=16) THEN
    -- Keep the canonical name: migration 006 runs on every initialization.
    DROP INDEX ch_archive_fragments_lower_trgm;
    CREATE INDEX ch_archive_fragments_lower_trgm ON ch_archive_fragments USING gin(value gin_trgm_ops);
    ANALYZE ch_archive_fragments;
    INSERT INTO ch_schema_migrations(version) VALUES(16);
  END IF;
END $$;
