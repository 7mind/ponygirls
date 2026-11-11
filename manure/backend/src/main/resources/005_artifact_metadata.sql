-- Explicit artifact metadata, byte-exact including NUL. Existing rows have no provenance.
ALTER TABLE manure.artifacts ADD COLUMN IF NOT EXISTS tags_json bytea NOT NULL DEFAULT decode('5b5d','hex');
ALTER TABLE manure.artifacts ADD COLUMN IF NOT EXISTS hostname bytea;
ALTER TABLE manure.artifacts ADD COLUMN IF NOT EXISTS project_path bytea;
ALTER TABLE manure.artifacts ADD COLUMN IF NOT EXISTS hostname_match bytea;
ALTER TABLE manure.artifacts ADD COLUMN IF NOT EXISTS project_path_match bytea;
CREATE TABLE IF NOT EXISTS manure.artifact_tags (
 artifact_id bytea NOT NULL REFERENCES manure.artifacts(id) ON DELETE CASCADE,
 tag bytea NOT NULL, tag_match bytea NOT NULL, PRIMARY KEY(artifact_id,tag)
);
