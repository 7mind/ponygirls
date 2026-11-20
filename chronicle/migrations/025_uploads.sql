-- Part uploads (docs/drafts/20261120-1201-append-only-ingest-spec.md sections 2 and 4.5): a request intent
-- (owner, source_key, request_id) is bound to the digest of its declaration and commits once, into ch_ingest_receipts;
-- each try is an attempt. An attempt stages its parts in an epoch beyond every committed count (the head's epoch for an
-- append, a new epoch for a replacement), which owns them through ch_epochs.tail_upload. Runs at every start; idempotent.
CREATE TABLE IF NOT EXISTS ch_uploads(
  id uuid PRIMARY KEY,
  owner text NOT NULL REFERENCES ch_users(id),
  source_key text NOT NULL,
  request_id uuid NOT NULL,
  attempt integer NOT NULL CHECK(attempt>=1),
  -- The head's id, or an id reserved for a new source: the commit creates its ch_sources row.
  session_id uuid NOT NULL,
  declaration jsonb NOT NULL,
  declaration_digest text NOT NULL,
  -- No foreign key: the sweep deletes the epochs of purged sources and of attempts that never committed.
  epoch uuid NOT NULL,
  append boolean NOT NULL,
  base_count integer NOT NULL CHECK(base_count>=0),
  base_raw_bytes bigint NOT NULL CHECK(base_raw_bytes>=0),
  base_records integer NOT NULL CHECK(base_records>=0),
  base_message_bytes bigint NOT NULL CHECK(base_message_bytes>=0),
  base_fragment_count bigint NOT NULL CHECK(base_fragment_count>=0),
  parts integer NOT NULL DEFAULT 0 CHECK(parts>=0),
  messages integer NOT NULL DEFAULT 0 CHECK(messages>=0),
  raw_bytes bigint NOT NULL DEFAULT 0 CHECK(raw_bytes>=0),
  records integer NOT NULL DEFAULT 0 CHECK(records>=0),
  message_bytes bigint NOT NULL DEFAULT 0 CHECK(message_bytes>=0),
  fragment_count bigint NOT NULL DEFAULT 0 CHECK(fragment_count>=0),
  -- ResumableSha256 state and MessageChain v1 after the base and the accepted parts.
  raw_state bytea NOT NULL CHECK(octet_length(raw_state) BETWEEN 40 AND 103),
  message_chain bytea NOT NULL CHECK(octet_length(message_chain)=32),
  -- The largest recordIndex of an accepted message, -1 before any; below the record count at the commit.
  max_record_index integer NOT NULL DEFAULT -1,
  message_time text,
  phase text NOT NULL CHECK(phase IN('Open','Committed','Aborted','Expired','Failed')),
  -- Set once, when the attempt's staging has been deleted (or was never its own any more).
  cleaned boolean NOT NULL DEFAULT false,
  receipt jsonb,
  failure text,
  expires_at timestamptz NOT NULL,
  terminal_at timestamptz,
  CHECK((phase='Open')=(terminal_at IS NULL)),
  CHECK((phase='Committed')=(receipt IS NOT NULL)),
  UNIQUE(owner,source_key,request_id,attempt));
-- One live or committed attempt per intent, one live attempt per source.
CREATE UNIQUE INDEX IF NOT EXISTS ch_uploads_intent ON ch_uploads(owner,source_key,request_id) WHERE phase IN('Open','Committed');
CREATE UNIQUE INDEX IF NOT EXISTS ch_uploads_live ON ch_uploads(owner,source_key) WHERE phase='Open';
CREATE INDEX IF NOT EXISTS ch_uploads_owner_live ON ch_uploads(owner) WHERE phase='Open';
CREATE INDEX IF NOT EXISTS ch_uploads_sweep ON ch_uploads(id) WHERE phase='Open' OR NOT cleaned;
CREATE INDEX IF NOT EXISTS ch_uploads_retired ON ch_uploads(terminal_at) WHERE cleaned AND phase IN('Aborted','Expired','Failed');
-- Every accepted part with its cumulative ends (messages, raw bytes, records) after it.
CREATE TABLE IF NOT EXISTS ch_upload_parts(
  upload uuid NOT NULL REFERENCES ch_uploads(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK(ordinal>=0),
  sha256 text NOT NULL,
  messages_end integer NOT NULL,
  raw_end bigint NOT NULL,
  records_end integer NOT NULL,
  PRIMARY KEY(upload,ordinal));
-- parentId values not yet found among the epoch's message ids and record ids, as SHA-256 keys of the string.
CREATE TABLE IF NOT EXISTS ch_upload_parents(
  upload uuid NOT NULL REFERENCES ch_uploads(id) ON DELETE CASCADE,
  parent_key bytea NOT NULL CHECK(octet_length(parent_key)=32),
  PRIMARY KEY(upload,parent_key));
-- The attempt that owns the epoch's rows beyond every committed count (or all its rows while no revision references it).
ALTER TABLE ch_epochs ADD COLUMN IF NOT EXISTS tail_upload uuid;
INSERT INTO ch_schema_migrations VALUES(25) ON CONFLICT DO NOTHING;
