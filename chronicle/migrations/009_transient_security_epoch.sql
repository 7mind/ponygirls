CREATE TABLE IF NOT EXISTS ch_security_epoch (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL CHECK (revision >= 0)
);
INSERT INTO ch_security_epoch(singleton,revision) VALUES(true,0) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION ch_advance_security_epoch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ch_security_epoch SET revision=revision+1 WHERE singleton;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'security epoch missing';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ch_security_members ON ch_members;
CREATE TRIGGER ch_security_members AFTER INSERT OR UPDATE OR DELETE ON ch_members
FOR EACH ROW EXECUTE FUNCTION ch_advance_security_epoch();

DROP TRIGGER IF EXISTS ch_security_users ON ch_users;
CREATE TRIGGER ch_security_users AFTER UPDATE ON ch_users
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION ch_advance_security_epoch();

DROP TRIGGER IF EXISTS ch_security_sessions ON ch_sessions;
CREATE TRIGGER ch_security_sessions AFTER DELETE ON ch_sessions
FOR EACH ROW EXECUTE FUNCTION ch_advance_security_epoch();

DROP TRIGGER IF EXISTS ch_security_session_update ON ch_sessions;
CREATE TRIGGER ch_security_session_update AFTER UPDATE ON ch_sessions
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION ch_advance_security_epoch();

DROP TRIGGER IF EXISTS ch_security_sources ON ch_sources;
CREATE TRIGGER ch_security_sources AFTER UPDATE ON ch_sources
FOR EACH ROW WHEN (OLD.owner IS DISTINCT FROM NEW.owner OR OLD.tombstone IS DISTINCT FROM NEW.tombstone)
EXECUTE FUNCTION ch_advance_security_epoch();

DROP TRIGGER IF EXISTS ch_security_source_delete ON ch_sources;
CREATE TRIGGER ch_security_source_delete AFTER DELETE ON ch_sources
FOR EACH ROW EXECUTE FUNCTION ch_advance_security_epoch();

DROP TRIGGER IF EXISTS ch_security_revisions ON ch_revisions;
CREATE TRIGGER ch_security_revisions AFTER DELETE ON ch_revisions
FOR EACH ROW EXECUTE FUNCTION ch_advance_security_epoch();

DROP TRIGGER IF EXISTS ch_security_generations ON ch_generations;
CREATE TRIGGER ch_security_generations AFTER DELETE ON ch_generations
FOR EACH ROW EXECUTE FUNCTION ch_advance_security_epoch();

DO $$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['ch_members','ch_users','ch_sessions','ch_sources','ch_revisions','ch_generations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS ch_security_truncate ON %I',relation_name);
    EXECUTE format('CREATE TRIGGER ch_security_truncate AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION ch_advance_security_epoch()',relation_name);
  END LOOP;
END;
$$;
INSERT INTO ch_schema_migrations VALUES(9) ON CONFLICT DO NOTHING;
