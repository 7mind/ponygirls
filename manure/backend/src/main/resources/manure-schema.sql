-- Canonical Manure PG schema. TEXT = exact UTF8 bytea, REAL = BE binary64
-- bytea. *_value columns are query projections, never authoritative.
CREATE SCHEMA IF NOT EXISTS manure;
CREATE TABLE IF NOT EXISTS manure.artifacts (
 id bytea PRIMARY KEY, name bytea NOT NULL, kind bytea NOT NULL,
 visibility bytea NOT NULL, created_by_user bytea NOT NULL,
 created_by_token bytea NOT NULL, created_at bytea NOT NULL,
 created_at_s bytea NOT NULL CHECK (octet_length(created_at_s)=8),
 expires_at bytea, expires_at_s bytea CHECK (octet_length(expires_at_s)=8),
 state bytea NOT NULL, total_bytes bigint, file_count bigint,
 reserved_bytes bigint, ext_pwd_hash bytea,
 last_activity_at bytea NOT NULL CHECK (octet_length(last_activity_at)=8),
 manifest_json bytea NOT NULL,
 created_at_s_value double precision NOT NULL,
 expires_at_s_value double precision,
 last_activity_at_value double precision NOT NULL
);
CREATE TABLE IF NOT EXISTS manure.receipts (
 artifact_id bytea REFERENCES manure.artifacts(id) ON DELETE CASCADE,
 path bytea, "offset" bigint, length bigint, sha256 bytea,
 PRIMARY KEY (artifact_id,path,"offset")
);
CREATE TABLE IF NOT EXISTS manure.one_time_grants (
 grant_hash bytea PRIMARY KEY,
 artifact_id bytea NOT NULL REFERENCES manure.artifacts(id) ON DELETE CASCADE,
 principal bytea NOT NULL,
 expires_at bytea NOT NULL CHECK (octet_length(expires_at)=8),
 used bigint NOT NULL DEFAULT 0, user_id bytea, token_id bytea, token_digest bytea,
 expires_at_value double precision NOT NULL
);
CREATE TABLE IF NOT EXISTS manure.content_grants (
 grant_hash bytea PRIMARY KEY,
 artifact_id bytea NOT NULL REFERENCES manure.artifacts(id) ON DELETE CASCADE,
 expires_at bytea NOT NULL CHECK (octet_length(expires_at)=8),
 created_at bytea NOT NULL CHECK (octet_length(created_at)=8),
 user_id bytea, token_id bytea, token_digest bytea, pwd_hash bytea,
 expires_at_value double precision NOT NULL,
 created_at_value double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_state ON manure.artifacts(state);
CREATE INDEX IF NOT EXISTS artifacts_expiry ON manure.artifacts(expires_at_s_value);
CREATE INDEX IF NOT EXISTS one_time_grants_expiry ON manure.one_time_grants(expires_at_value);
CREATE INDEX IF NOT EXISTS content_grants_expiry ON manure.content_grants(expires_at_value);
