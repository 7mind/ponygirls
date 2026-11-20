-- Rollback of part uploads, migration 025 (docs/drafts/20261120-1201-append-only-ingest-spec.md §9). Run by an operator
-- with the S2 server stopped and every collector on uploadProtocol "whole"; then deploy the S1 server (whose start does
-- not re-create these objects). It ends every upload attempt, deletes all staged content (epoch rows beyond the counts of
-- every committed revision of their epoch, and epochs that no revision references) and drops ch_uploads,
-- ch_upload_parts, ch_upload_parents and ch_epochs.tail_upload. Committed uploads are ordinary epoch revisions and stay,
-- with their receipts in ch_ingest_receipts. Irreversible: live uploads restart from their first part after an upgrade.
--   psql -X -q -v ON_ERROR_STOP=1 [-v mode=preflight] -f chronicle/scripts/down-025-uploads.sql    (read-only; prints the plan)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=dry-run -f …    (every change, then ROLLBACK)
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=apply -v apply_irreversible=yes -v confirm_database=<name> -v expect_plan=<token> -f …
-- Prints `DOWN025.<key>|<value>` lines; the last line is `DOWN025.result|<outcome>`. Any refusal happens before the
-- first change and exits 3. One transaction: a cut run changed nothing; run the preflight again.
-- Tested by chronicle/server/src/test/scala/chronicle/UploadBoundaryTest.scala.
\set ON_ERROR_STOP on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
\if :{?mode}
\else
\set mode preflight
\endif
\if :{?apply_irreversible}
\else
\set apply_irreversible no
\endif
\if :{?confirm_database}
\else
\set confirm_database ''
\endif
\if :{?expect_plan}
\else
\set expect_plan ''
\endif
SET search_path = pg_catalog, public;
SET statement_timeout = 0;
SET lock_timeout = '5s';
SELECT :'mode' IN ('preflight', 'dry-run', 'apply') AS d_known, :'mode' = 'preflight' AS d_preflight, :'mode' = 'apply' AS d_apply,
  to_regclass('public.ch_uploads') IS NOT NULL AS d_present, current_database() AS d_database \gset
\if :d_known
\else
\echo DOWN025.result|refused-unknown-mode
DO $$ BEGIN RAISE EXCEPTION 'down-025 refused: mode is preflight, dry-run or apply'; END $$;
\endif
\echo DOWN025.database|:d_database
\if :d_present
\else
\echo DOWN025.result|absent
\quit
\endif
\if :d_preflight
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
\else
BEGIN;
LOCK TABLE ch_uploads, ch_epochs IN ACCESS EXCLUSIVE MODE;
\endif
-- Staged rows: at or beyond the largest count of the revisions of their epoch (0 for an epoch without one).
\set floors '(SELECT e.id AS epoch, coalesce(max(r.message_count), 0) AS messages, coalesce(max(r.raw_bytes), 0) AS raw_bytes, coalesce(max(r.record_count), 0) AS records, count(r.revision) AS revisions FROM ch_epochs e LEFT JOIN ch_revisions r ON r.epoch = e.id GROUP BY e.id)'
SELECT
  (SELECT count(*) FROM ch_uploads WHERE phase = 'Open') AS d_live,
  (SELECT count(*) FROM ch_uploads WHERE phase <> 'Open' AND NOT cleaned) AS d_ended,
  (SELECT count(*) FROM ch_uploads WHERE phase = 'Committed') AS d_committed,
  (SELECT count(*) FROM :floors f WHERE revisions = 0) AS d_epochs,
  (SELECT count(*) FROM :floors f JOIN ch_epoch_messages m ON m.epoch = f.epoch AND m.position >= f.messages) AS d_messages,
  (SELECT count(*) FROM :floors f JOIN ch_epoch_raw w ON w.epoch = f.epoch AND w.byte_offset >= f.raw_bytes) AS d_raw,
  (SELECT coalesce(sum(octet_length(w.content)), 0) FROM :floors f JOIN ch_epoch_raw w ON w.epoch = f.epoch AND w.byte_offset >= f.raw_bytes) AS d_raw_bytes,
  (SELECT count(*) FROM :floors f JOIN ch_epoch_records k ON k.epoch = f.epoch AND k.record_index >= f.records) AS d_records,
  (SELECT count(*) FROM :floors f JOIN ch_epoch_fragments g ON g.epoch = f.epoch AND g.position >= f.messages) AS d_fragments \gset
-- The plan token binds the attempts that are not settled and every count above.
SELECT md5(concat_ws('|', (SELECT string_agg(concat_ws(':', id, phase, parts, raw_bytes, cleaned), ',' ORDER BY id) FROM ch_uploads WHERE phase = 'Open' OR NOT cleaned),
  :d_live, :d_ended, :d_committed, :d_epochs, :d_messages, :d_raw, :d_raw_bytes, :d_records, :d_fragments)) AS d_plan \gset
\echo DOWN025.uploads.live|:d_live
\echo DOWN025.uploads.ended_with_staging|:d_ended
\echo DOWN025.uploads.committed_kept_as_revisions|:d_committed
\echo DOWN025.staged.epochs_without_revision|:d_epochs
\echo DOWN025.staged.messages|:d_messages
\echo DOWN025.staged.raw_segments|:d_raw
\echo DOWN025.staged.raw_bytes|:d_raw_bytes
\echo DOWN025.staged.records|:d_records
\echo DOWN025.staged.fragments|:d_fragments
\echo DOWN025.plan|:d_plan
\if :d_preflight
ROLLBACK;
\echo DOWN025.result|preflight-complete
\quit
\endif
\if :d_apply
SELECT :'apply_irreversible' = 'yes' AND :'confirm_database' = current_database() AND :'expect_plan' = :'d_plan' AS d_confirmed \gset
\if :d_confirmed
\else
ROLLBACK;
\echo DOWN025.result|refused-unconfirmed
DO $$ BEGIN RAISE EXCEPTION 'down-025 refused before any change: apply needs apply_irreversible=yes, confirm_database=<this database> and expect_plan=<the preflight plan>'; END $$;
\endif
\endif
DELETE FROM ch_epoch_fragments g USING :floors f WHERE g.epoch = f.epoch AND g.position >= f.messages;
DELETE FROM ch_epoch_records k USING :floors f WHERE k.epoch = f.epoch AND k.record_index >= f.records;
DELETE FROM ch_epoch_raw w USING :floors f WHERE w.epoch = f.epoch AND w.byte_offset >= f.raw_bytes;
DELETE FROM ch_epoch_messages m USING :floors f WHERE m.epoch = f.epoch AND m.position >= f.messages;
DELETE FROM ch_epochs e WHERE NOT EXISTS (SELECT 1 FROM ch_revisions r WHERE r.epoch = e.id);
DROP TABLE ch_upload_parents, ch_upload_parts, ch_uploads;
ALTER TABLE ch_epochs DROP COLUMN tail_upload;
DELETE FROM ch_schema_migrations WHERE version = 25;
\if :d_apply
COMMIT;
\echo DOWN025.result|applied
\else
ROLLBACK;
\echo DOWN025.result|dry-run-complete
\endif
