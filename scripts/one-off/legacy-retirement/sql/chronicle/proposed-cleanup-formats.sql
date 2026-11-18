-- PROPOSAL, not applied by run.sh: the schema change for the publication-formats item (plan section 6.6); only when
-- that item was carried out. A retired generation keeps its historical format label; a generation that is not
-- retired can only be in the current format. Precondition: `run.sh chronicle verify` is zero.
BEGIN;
ALTER TABLE ch_generations ADD CONSTRAINT ch_generations_current_format_check
  CHECK (retired OR (passage_format IS NOT NULL AND passage_format = 'ContextAwareProblems'));
INSERT INTO ch_schema_migrations VALUES (22) ON CONFLICT DO NOTHING;
COMMIT;
