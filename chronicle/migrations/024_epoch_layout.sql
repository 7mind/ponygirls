-- Epoch layout (docs/drafts/20261120-1201-append-only-ingest-spec.md sections 1.1 and 2): an epoch is one linear
-- history of a source (messages by position, raw by byte offset, record keys, fragments by position); an epoch revision
-- sees the prefix below its counts, a legacy revision keeps its snapshot. Runs at every start after 013, which re-creates
-- ch_immutable_revision() with its old body, so every statement is idempotent and that body is re-asserted here.
CREATE TABLE IF NOT EXISTS ch_epochs(
  id uuid PRIMARY KEY,
  -- No foreign key: an upload of a new source reserves the id before ch_sources has the row.
  session_id uuid NOT NULL,
  raw_path text NOT NULL,
  candidates text NOT NULL DEFAULT 'current' CHECK(candidates IN('current','prune','pruned')));
CREATE INDEX IF NOT EXISTS ch_epochs_session ON ch_epochs(session_id);
CREATE INDEX IF NOT EXISTS ch_epochs_prune ON ch_epochs(id) WHERE candidates='prune';
CREATE TABLE IF NOT EXISTS ch_epoch_messages(
  epoch uuid NOT NULL REFERENCES ch_epochs(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK(position>=0),
  message_id text NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY(epoch,position),
  UNIQUE(epoch,message_id));
-- Whole lines, at most 1 MiB per segment unless one line is longer.
CREATE TABLE IF NOT EXISTS ch_epoch_raw(
  epoch uuid NOT NULL REFERENCES ch_epochs(id) ON DELETE CASCADE,
  byte_offset bigint NOT NULL CHECK(byte_offset>=0),
  content text NOT NULL,
  PRIMARY KEY(epoch,byte_offset));
-- SHA-256 of the id or uuid string of each raw record, for parentId resolution.
CREATE TABLE IF NOT EXISTS ch_epoch_records(
  epoch uuid NOT NULL REFERENCES ch_epochs(id) ON DELETE CASCADE,
  record_index integer NOT NULL,
  record_key bytea NOT NULL CHECK(octet_length(record_key)=32),
  PRIMARY KEY(epoch,record_index,record_key));
CREATE INDEX IF NOT EXISTS ch_epoch_records_key ON ch_epoch_records(epoch,record_key);
CREATE TABLE IF NOT EXISTS ch_epoch_fragments(
  epoch uuid NOT NULL REFERENCES ch_epochs(id) ON DELETE CASCADE,
  position integer NOT NULL,
  part integer NOT NULL,
  value text COLLATE "pg_unicode_fast" NOT NULL,
  head_candidate boolean NOT NULL DEFAULT true,
  PRIMARY KEY(epoch,position,part));
CREATE INDEX IF NOT EXISTS ch_epoch_fragments_lower_trgm ON ch_epoch_fragments USING gin(value gin_trgm_ops) WHERE head_candidate;

ALTER TABLE ch_revisions ALTER COLUMN snapshot DROP NOT NULL;
ALTER TABLE ch_revisions ADD COLUMN IF NOT EXISTS epoch uuid REFERENCES ch_epochs(id),
  -- The ingest request without messages and files (a legacy snapshot minus its messages and files).
  ADD COLUMN IF NOT EXISTS envelope jsonb,
  ADD COLUMN IF NOT EXISTS message_count integer,
  ADD COLUMN IF NOT EXISTS record_count integer,
  ADD COLUMN IF NOT EXISTS raw_bytes bigint,
  -- Sum of the UTF-8 bytes of the stored message values.
  ADD COLUMN IF NOT EXISTS message_bytes bigint,
  -- Sum of ceil(text bytes / 2,045) over the non-empty message texts (the indexing budget).
  ADD COLUMN IF NOT EXISTS fragment_count bigint,
  -- ResumableSha256 state after raw_bytes.
  ADD COLUMN IF NOT EXISTS raw_state bytea,
  -- MessageChain v1 after message_count messages.
  ADD COLUMN IF NOT EXISTS message_chain bytea,
  -- Latest parsed message timestamp (Instant.toString).
  ADD COLUMN IF NOT EXISTS message_time text;
-- Added once without a scan, then validated (a no-op once valid; reads the heap, not the TOASTed snapshots).
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='ch_revisions'::regclass AND conname='ch_revisions_layout') THEN
    ALTER TABLE ch_revisions ADD CONSTRAINT ch_revisions_layout CHECK(
      (epoch IS NULL AND snapshot IS NOT NULL AND envelope IS NULL AND message_count IS NULL AND record_count IS NULL
        AND raw_bytes IS NULL AND message_bytes IS NULL AND fragment_count IS NULL AND raw_state IS NULL
        AND message_chain IS NULL AND message_time IS NULL)
      OR (epoch IS NOT NULL AND snapshot IS NULL AND envelope IS NOT NULL AND message_count>=0 AND record_count>=0
        AND raw_bytes>=0 AND message_bytes>=0 AND fragment_count>=0 AND octet_length(raw_state) BETWEEN 40 AND 103
        AND octet_length(message_chain)=32)) NOT VALID;
  END IF;
END $$;
ALTER TABLE ch_revisions VALIDATE CONSTRAINT ch_revisions_layout;
CREATE INDEX IF NOT EXISTS ch_revisions_epoch ON ch_revisions(epoch,message_count) WHERE epoch IS NOT NULL;

CREATE OR REPLACE FUNCTION ch_immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.binding_id IS DISTINCT FROM OLD.binding_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
    OR NEW.epoch IS DISTINCT FROM OLD.epoch OR NEW.envelope IS DISTINCT FROM OLD.envelope
    OR NEW.message_count IS DISTINCT FROM OLD.message_count OR NEW.record_count IS DISTINCT FROM OLD.record_count
    OR NEW.raw_bytes IS DISTINCT FROM OLD.raw_bytes OR NEW.message_bytes IS DISTINCT FROM OLD.message_bytes
    OR NEW.fragment_count IS DISTINCT FROM OLD.fragment_count OR NEW.raw_state IS DISTINCT FROM OLD.raw_state
    OR NEW.message_chain IS DISTINCT FROM OLD.message_chain OR NEW.message_time IS DISTINCT FROM OLD.message_time THEN
    RAISE EXCEPTION 'immutable archive revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ch_immutable_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.raw_path IS DISTINCT FROM OLD.raw_path THEN
    RAISE EXCEPTION 'immutable epoch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER ch_immutable_epoch BEFORE UPDATE ON ch_epochs FOR EACH ROW EXECUTE FUNCTION ch_immutable_epoch();

-- Epoch rows never change; a fragment may only change its head-candidate mask (pruning a superseded epoch).
CREATE OR REPLACE FUNCTION ch_immutable_epoch_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- PL/pgSQL plans each expression on first use, so a fragment-only column is referenced only for fragments.
  IF TG_TABLE_NAME='ch_epoch_fragments' THEN
    IF NEW.epoch=OLD.epoch AND NEW.position=OLD.position AND NEW.part=OLD.part AND NEW.value=OLD.value THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'immutable epoch row' USING ERRCODE='23514';
END;
$$;
CREATE OR REPLACE TRIGGER ch_immutable_epoch_rows BEFORE UPDATE ON ch_epoch_messages FOR EACH ROW EXECUTE FUNCTION ch_immutable_epoch_rows();
CREATE OR REPLACE TRIGGER ch_immutable_epoch_rows BEFORE UPDATE ON ch_epoch_raw FOR EACH ROW EXECUTE FUNCTION ch_immutable_epoch_rows();
CREATE OR REPLACE TRIGGER ch_immutable_epoch_rows BEFORE UPDATE ON ch_epoch_records FOR EACH ROW EXECUTE FUNCTION ch_immutable_epoch_rows();
CREATE OR REPLACE TRIGGER ch_immutable_epoch_rows BEFORE UPDATE ON ch_epoch_fragments FOR EACH ROW EXECUTE FUNCTION ch_immutable_epoch_rows();

-- A row below a count of any revision of its epoch is committed content; only staged rows (beyond every count) and the
-- rows of an epoch whose revisions were purged can be deleted.
CREATE OR REPLACE FUNCTION ch_epoch_rows_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  committed boolean;
BEGIN
  IF TG_TABLE_NAME='ch_epoch_raw' THEN
    committed:=EXISTS(SELECT 1 FROM ch_revisions WHERE epoch=OLD.epoch AND raw_bytes>OLD.byte_offset);
  ELSIF TG_TABLE_NAME='ch_epoch_records' THEN
    committed:=EXISTS(SELECT 1 FROM ch_revisions WHERE epoch=OLD.epoch AND record_count>OLD.record_index);
  ELSE
    committed:=EXISTS(SELECT 1 FROM ch_revisions WHERE epoch=OLD.epoch AND message_count>OLD.position);
  END IF;
  IF committed THEN
    RAISE EXCEPTION 'committed epoch row' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE OR REPLACE TRIGGER ch_epoch_rows_guard BEFORE DELETE ON ch_epoch_messages FOR EACH ROW EXECUTE FUNCTION ch_epoch_rows_guard();
CREATE OR REPLACE TRIGGER ch_epoch_rows_guard BEFORE DELETE ON ch_epoch_raw FOR EACH ROW EXECUTE FUNCTION ch_epoch_rows_guard();
CREATE OR REPLACE TRIGGER ch_epoch_rows_guard BEFORE DELETE ON ch_epoch_records FOR EACH ROW EXECUTE FUNCTION ch_epoch_rows_guard();
CREATE OR REPLACE TRIGGER ch_epoch_rows_guard BEFORE DELETE ON ch_epoch_fragments FOR EACH ROW EXECUTE FUNCTION ch_epoch_rows_guard();
INSERT INTO ch_schema_migrations VALUES(24) ON CONFLICT DO NOTHING;
