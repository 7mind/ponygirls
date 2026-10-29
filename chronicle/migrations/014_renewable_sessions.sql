-- Extending a still-live cookie's lifetime is not a security-policy change.
-- Evaluate liveness at the row trigger, including time spent waiting for a row lock.
DROP TRIGGER IF EXISTS ch_security_session_update ON ch_sessions;
CREATE TRIGGER ch_security_session_update AFTER UPDATE ON ch_sessions
FOR EACH ROW WHEN (
  OLD IS DISTINCT FROM NEW AND (
    OLD.hash IS DISTINCT FROM NEW.hash OR
    OLD.owner IS DISTINCT FROM NEW.owner OR
    NEW.expires < OLD.expires OR
    OLD.expires <= clock_timestamp()
  )
) EXECUTE FUNCTION ch_advance_security_epoch();

INSERT INTO ch_schema_migrations VALUES(14) ON CONFLICT DO NOTHING;
