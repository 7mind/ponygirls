ALTER TABLE ch_sessions ALTER COLUMN expires DROP NOT NULL;

INSERT INTO ch_schema_migrations VALUES(20) ON CONFLICT DO NOTHING;

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
