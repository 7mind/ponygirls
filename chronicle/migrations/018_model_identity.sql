CREATE TABLE IF NOT EXISTS ch_model_identity_migrations(
  legacy_profile text PRIMARY KEY,
  canonical_profile text NOT NULL REFERENCES ch_index_profiles(profile),
  legacy_space text NOT NULL REFERENCES ch_embedding_spaces(id),
  canonical_space text NOT NULL REFERENCES ch_embedding_spaces(id)
);
CREATE TABLE IF NOT EXISTS ch_checkpoint_namespaces(
  job_id uuid NOT NULL REFERENCES ch_jobs(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  profile text NOT NULL,
  embedding_space text NOT NULL REFERENCES ch_embedding_spaces(id),
  PRIMARY KEY(job_id,run_id)
);
