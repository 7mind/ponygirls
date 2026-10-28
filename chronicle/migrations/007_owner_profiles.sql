CREATE TABLE IF NOT EXISTS ch_embedding_spaces(
  id text PRIMARY KEY,
  descriptor jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS ch_index_profiles(
  profile text PRIMARY KEY,
  embedding_space text NOT NULL REFERENCES ch_embedding_spaces(id),
  policy text NOT NULL CHECK(policy IN('LegacyV4','ContiguousPassagesV1','ContextAwareProblemsV1')),
  descriptor jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS ch_owner_targets(
  owner text PRIMARY KEY REFERENCES ch_users(id),
  profile text NOT NULL,
  epoch bigint NOT NULL DEFAULT 0 CHECK(epoch>=0)
);
CREATE INDEX IF NOT EXISTS ch_owner_targets_profile ON ch_owner_targets(profile,owner);
