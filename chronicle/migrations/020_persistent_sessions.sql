ALTER TABLE ch_sessions ALTER COLUMN expires DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ch_schema_migrations WHERE version=20) THEN
    LOCK TABLE ch_sessions IN ACCESS EXCLUSIVE MODE;
    DELETE FROM ch_sessions WHERE expires<=clock_timestamp();
    UPDATE ch_sessions SET expires=NULL WHERE expires>clock_timestamp();
    INSERT INTO ch_schema_migrations VALUES(20);
  END IF;
END;
$$;

-- Cookie refresh does not mutate authority. Explicitly imposing/reducing a
-- deadline, changing the credential/owner or reviving an expired row does.
DROP TRIGGER IF EXISTS ch_security_session_update ON ch_sessions;
CREATE TRIGGER ch_security_session_update AFTER UPDATE ON ch_sessions
FOR EACH ROW WHEN (
  OLD IS DISTINCT FROM NEW AND (
    OLD.hash IS DISTINCT FROM NEW.hash OR
    OLD.owner IS DISTINCT FROM NEW.owner OR
    (OLD.expires IS NULL AND NEW.expires IS NOT NULL) OR
    (OLD.expires IS NOT NULL AND (
      OLD.expires<=clock_timestamp() OR
      (NEW.expires IS NOT NULL AND NEW.expires<OLD.expires)
    ))
  )
) EXECUTE FUNCTION ch_advance_security_epoch();
