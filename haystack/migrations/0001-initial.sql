-- Haystack initial schema (0001). Normative storage: plan §6, docs/model.md.
-- No target/project foreign keys (dangling + cross-project links permitted).
-- document_text is authoritative (lossless round-trip); document (jsonb) is
-- the Step 4 predicate projection, written from the same canonical bytes.

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE store_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  activity_project_id TEXT NOT NULL
);

CREATE TABLE items (
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  document JSONB NOT NULL,
  document_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL,
  modified_at TIMESTAMPTZ NOT NULL,
  modified_by TEXT NOT NULL,
  PRIMARY KEY (project_id, item_id)
);

CREATE TABLE item_revisions (
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  document JSONB NOT NULL,
  document_text TEXT NOT NULL,
  modified_at TIMESTAMPTZ NOT NULL,
  modified_by TEXT NOT NULL,
  token_id TEXT NOT NULL,
  PRIMARY KEY (project_id, item_id, revision)
);

CREATE TABLE item_links (
  source_project_id TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  link_type TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  target_item_id TEXT NOT NULL,
  PRIMARY KEY (source_project_id, source_item_id, position)
);
CREATE INDEX item_links_target_idx
  ON item_links (target_project_id, target_item_id, link_type);

CREATE TABLE write_requests (
  principal_user TEXT NOT NULL,
  token_id TEXT NOT NULL,
  request_id UUID NOT NULL,
  digest_format TEXT NOT NULL DEFAULT 'haystack-op-v1',
  digest TEXT NOT NULL,
  outcome JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_user, token_id, request_id)
);
