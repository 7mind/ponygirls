-- Model identity v1 is retired (docs/drafts/20261118-1100-legacy-data-retirement.md §6.6): no code reads the
-- retained-read approvals, the relocation mapping, the checkpoint namespaces or the pre-owner-target singleton.
-- Runs at every start, after Database.initialize has refused rows this would discard: a previous release started on
-- this database (deployment rollback) re-creates the four tables, and the next start drops them again.
DROP TABLE IF EXISTS ch_retained_profile_reads,ch_checkpoint_namespaces,ch_model_identity_migrations,ch_profile;
INSERT INTO ch_schema_migrations VALUES(21) ON CONFLICT DO NOTHING;
