-- Logical identities survive logical backup/restore; physical xmin must never bind durable accepted work.
ALTER TABLE ch_revisions ADD COLUMN IF NOT EXISTS binding_id uuid;
UPDATE ch_revisions SET binding_id=gen_random_uuid() WHERE binding_id IS NULL;
ALTER TABLE ch_revisions ALTER COLUMN binding_id SET DEFAULT gen_random_uuid();
ALTER TABLE ch_revisions ALTER COLUMN binding_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ch_revision_bindings ON ch_revisions(binding_id);

CREATE OR REPLACE FUNCTION ch_immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.binding_id IS DISTINCT FROM OLD.binding_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
    RAISE EXCEPTION 'immutable archive revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ch_immutable_revision ON ch_revisions;
CREATE TRIGGER ch_immutable_revision BEFORE UPDATE ON ch_revisions FOR EACH ROW EXECUTE FUNCTION ch_immutable_revision();
