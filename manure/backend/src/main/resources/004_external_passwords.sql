-- Recoverable values are deliberately separate from metadata/search projections.
-- Database snapshots/backups now have the same sensitivity as credentials.
CREATE TABLE IF NOT EXISTS manure.external_passwords (
 artifact_id bytea PRIMARY KEY REFERENCES manure.artifacts(id) ON DELETE CASCADE,
 password bytea NOT NULL
);
