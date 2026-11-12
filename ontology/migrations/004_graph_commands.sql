DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ontology_mutations) THEN
    RAISE EXCEPTION 'Pre-command-primary ontology data requires an explicit cutover; automatic frontier reconstruction is forbidden';
  END IF;
END
$$;

ALTER TABLE ontology_captures DROP CONSTRAINT ontology_captures_kind;
ALTER TABLE ontology_captures ADD CONSTRAINT ontology_captures_kind
  CHECK (input_kind IN ('Capture', 'Judgment', 'GraphMutation'));
