CREATE TABLE IF NOT EXISTS ch_retained_profile_reads(
  profile text PRIMARY KEY REFERENCES ch_index_profiles(profile),
  legacy_space text NOT NULL REFERENCES ch_embedding_spaces(id),
  canonical_profile text NOT NULL REFERENCES ch_index_profiles(profile),
  canonical_space text NOT NULL REFERENCES ch_embedding_spaces(id),
  policy text NOT NULL CHECK(policy IN('LegacyV4','ContiguousPassagesV1','ContextAwareProblemsV1')),
  profile_descriptor jsonb NOT NULL,
  legacy_descriptor jsonb NOT NULL,
  canonical_descriptor jsonb NOT NULL,
  CHECK(legacy_space<>canonical_space)
);
