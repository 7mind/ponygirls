-- The preference epoch captured by a Running attempt. Pre-migration attempts have epoch 0.
-- A preference update does not rewrite the owner's archive or jobs.
ALTER TABLE ch_jobs ADD COLUMN IF NOT EXISTS indexing_epoch bigint NOT NULL DEFAULT 0;

-- Invalidate captured Chronicle model runs. The narrower revision lets other readers fence only indexing
-- changes without changing their existing ACL snapshot semantics. Rows for other services do not advance either.
ALTER TABLE ch_security_epoch ADD COLUMN IF NOT EXISTS indexing_revision bigint NOT NULL DEFAULT 0 CHECK(indexing_revision>=0);
CREATE OR REPLACE FUNCTION ch_indexing_preference_epoch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.service = 'chronicle' AND NEW.epoch <> COALESCE(OLD.epoch,0) THEN
    UPDATE ch_security_epoch SET revision=revision+1,indexing_revision=indexing_revision+1 WHERE singleton;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'security epoch missing';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS ch_security_indexing ON ponygirls_indexing_preferences;
CREATE TRIGGER ch_security_indexing AFTER INSERT OR UPDATE OF epoch ON ponygirls_indexing_preferences
FOR EACH ROW WHEN (NEW.service = 'chronicle') EXECUTE FUNCTION ch_indexing_preference_epoch();

INSERT INTO ch_schema_migrations VALUES(32) ON CONFLICT DO NOTHING;
