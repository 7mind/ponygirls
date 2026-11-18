-- PROPOSAL, not applied by run.sh: the schema change of the legacy-free Chronicle binary for the identity item
-- (plan section 6.6). It exists here so that the runbook's post-clean-up steps can be validated on a fixture
-- database; the deletion unit turns it into a start-up migration and removes 018/019 from the start-up list.
-- Precondition: `run.sh chronicle verify [--skip-formats]` is zero.
BEGIN;
DROP TABLE ch_retained_profile_reads;
DROP TABLE ch_checkpoint_namespaces;
DROP TABLE ch_model_identity_migrations;
DROP TABLE ch_profile;
INSERT INTO ch_schema_migrations VALUES (21) ON CONFLICT DO NOTHING;
COMMIT;
