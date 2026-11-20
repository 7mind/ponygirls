-- Down-script of migration 024 (docs/drafts/20261120-1201-append-only-ingest-spec.md §1.2): every epoch revision becomes
-- a legacy snapshot with its message and fragment rows again, then the epoch layout is removed, so the release before S1
-- can start. No binary applies it. The operator runs it with the server stopped (after the S2 down-script when S2 was
-- deployed), in psql's default autocommit mode (never with -1):
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=preflight -f chronicle/scripts/down-024-epoch-layout.sql
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=dry-run [purge options] -f chronicle/scripts/down-024-epoch-layout.sql
--   psql -X -q -v ON_ERROR_STOP=1 -v mode=apply -v apply_irreversible=yes -v confirm_database=<database>
--        -v expect_plan=<DOWN024.plan of the preflight just before> -v backup_reference=<backup> [purge options]
--        [-v max_sources=<N>] -f chronicle/scripts/down-024-epoch-layout.sql
-- preflight is read-only: every count, the revisions PostgreSQL cannot hold as a legacy snapshot (one jsonb value is
-- limited to 268,435,455 bytes) and the plan token. dry-run does everything in one transaction and rolls it back. apply
-- converts one source per transaction (each committed source leaves a database the S1 binary reads), then removes the
-- layout in one final transaction once no epoch revision remains. A cut run (DOWN024.result|incomplete|remaining=N, or
-- an interrupted session) is resumed by a new preflight and apply with its new plan token; converted sources are not
-- repeated.
-- When the preflight lists non-downgradable revisions, dry-run and apply refuse before any change unless the operator
-- chooses to purge those sources whole (irreversible for them; another owner's sources need that owner's consent):
--   -v purge_non_downgradable=yes -v confirm_purge_sources=<S of DOWN024.non_downgradable|R|sources=S>
-- The other choice is not to run apply and stay on S1. There is no per-revision skip.
-- Output: DOWN024.<key>|<value> lines (ids, counts and sizes, never content); the last one is DOWN024.result|<outcome>.
-- Exit 0 for preflight-complete, dry-run-rolled-back, applied and already-applied; 3 for every refusal and an incomplete
-- run (ON_ERROR_STOP).
-- Tested by chronicle/server/src/test/scala/chronicle/EpochDownScriptTest.scala.
\set ON_ERROR_STOP on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
\if :{?mode}
\else
\set mode ''
\endif
\if :{?apply_irreversible}
\else
\set apply_irreversible ''
\endif
\if :{?confirm_database}
\else
\set confirm_database ''
\endif
\if :{?expect_plan}
\else
\set expect_plan ''
\endif
\if :{?backup_reference}
\else
\set backup_reference ''
\endif
\if :{?purge_non_downgradable}
\else
\set purge_non_downgradable ''
\endif
\if :{?confirm_purge_sources}
\else
\set confirm_purge_sources ''
\endif
\if :{?max_sources}
\else
\set max_sources ''
\endif
-- The largest jsonb object of one key PostgreSQL accepts (a value up to 268,435,455 bytes, less the container).
\set jsonb_cap 268435442
-- An upper bound of the jsonb size of a revision's rebuilt snapshot: its envelope, path, digest, raw and message values
-- as text (jsonb stores strings unescaped, so their text is never smaller), 128 bytes per message for jsonb's entries,
-- alignment and numbers, 4 KiB for the snapshot, file and array containers.
\set snapshot_bound 'octet_length(r.envelope::text)::numeric+octet_length(e.raw_path)+64+r.raw_bytes+r.message_bytes+128::numeric*r.message_count+4096'
SET client_min_messages = warning;
SET search_path = pg_catalog, public;
SET statement_timeout = 0;
SET lock_timeout = '5s';
SELECT :'mode' IN ('preflight', 'dry-run', 'apply') AS d_mode_known, :'mode' = 'preflight' AS d_preflight,
  :'mode' = 'dry-run' AS d_dry_run, :'mode' = 'apply' AS d_apply, :'purge_non_downgradable' = 'yes' AS d_purge,
  :'purge_non_downgradable' IN ('', 'yes') AND (:'purge_non_downgradable' = 'yes') = (:'confirm_purge_sources' <> '')
    AND (:'confirm_purge_sources' = '' OR :'confirm_purge_sources' ~ '^[0-9]{1,9}$')
    AND (:'max_sources' = '' OR :'max_sources' ~ '^[1-9][0-9]{0,8}$') AS d_options_valid,
  :'apply_irreversible' || :'confirm_database' || :'expect_plan' || :'backup_reference' <> '' AS d_apply_flags_given,
  :'purge_non_downgradable' || :'confirm_purge_sources' || :'max_sources' <> '' AS d_change_options_given \gset
\if :d_mode_known
\else
\echo DOWN024.result|refused-mode
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: -v mode=preflight, dry-run or apply is required'; END $$;
\endif
\if :d_options_valid
\else
\echo DOWN024.result|refused-options
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: purge_non_downgradable=yes goes with confirm_purge_sources=<count>, max_sources is a positive count'; END $$;
\endif
\if :d_apply
SELECT array_to_string(array_remove(ARRAY[
    CASE WHEN :'apply_irreversible' <> 'yes' THEN 'apply_irreversible=yes' END,
    CASE WHEN :'confirm_database' IS DISTINCT FROM current_database() THEN 'confirm_database=<this database>' END,
    CASE WHEN :'expect_plan' !~ '^[0-9a-f]{32}$' THEN 'expect_plan=<DOWN024.plan>' END,
    CASE WHEN :'backup_reference' !~ '^[A-Za-z0-9_.:/@+=-]{1,200}$' THEN 'backup_reference=<backup>' END], NULL), ',') AS d_flags_missing \gset
SELECT :'d_flags_missing' = '' AS d_flags_complete \gset
\if :d_flags_complete
\else
\echo DOWN024.missing|:d_flags_missing
\echo DOWN024.result|refused-apply-flags
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: apply needs apply_irreversible=yes, confirm_database, expect_plan and backup_reference; nothing was changed'; END $$;
\endif
\elif :d_apply_flags_given
\echo DOWN024.result|refused-options
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: apply_irreversible, confirm_database, expect_plan and backup_reference belong to apply'; END $$;
\elif :d_preflight
\if :d_change_options_given
\echo DOWN024.result|refused-options
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: preflight takes no purge or batch option'; END $$;
\endif
\endif

-- Every table the script reads or writes must resolve in the service's schema, whatever the session's search_path.
SELECT coalesce(string_agg(format('%I.%I', 'public', t), ',' ORDER BY t), '') AS d_missing, count(*) > 0 AS d_has_missing
FROM unnest(string_to_array('ch_archive_fragments ch_chunks ch_generations ch_jobs ch_messages ch_revision_info ch_revisions ch_schema_migrations ch_sources', ' ')) t
WHERE to_regclass(format('%I.%I', 'public', t)) IS NULL \gset
\if :d_has_missing
\echo DOWN024.missing|:d_missing
\echo DOWN024.result|refused-missing-objects
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: expected tables do not resolve in schema public: wrong database, schema or role'; END $$;
\endif
SELECT to_regclass('public.ch_epochs') IS NOT NULL AS d_layout,
  EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid = 'public.ch_revisions'::regclass AND attname = 'epoch' AND NOT attisdropped) AS d_layout_columns \gset
\if :d_layout
\elif :d_layout_columns
\echo DOWN024.result|refused-partial-layout
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: ch_revisions has epoch columns without ch_epochs'; END $$;
\else
\echo DOWN024.database|:DBNAME
\echo DOWN024.result|already-applied
\quit
\endif
\if :d_layout_columns
\else
\echo DOWN024.result|refused-partial-layout
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: ch_epochs exists without the epoch columns of ch_revisions'; END $$;
\endif

-- The rebuilt legacy snapshot of epoch revision ($1,$2): the envelope (the request without messages and files), the
-- messages below its count and its one raw file (segments below raw_bytes are whole lines, so they concatenate to it).
SELECT set_config('down024.snapshot', $snapshot$
  SELECT r.envelope || jsonb_build_object(
    'messages', (SELECT coalesce(jsonb_agg(m.value ORDER BY m.position), '[]'::jsonb) FROM ch_epoch_messages m WHERE m.epoch = r.epoch AND m.position < r.message_count),
    'files', jsonb_build_array(jsonb_build_object('path', e.raw_path, 'sha256', r.envelope->>'digest',
      'content', (SELECT coalesce(string_agg(w.content, '' ORDER BY w.byte_offset), '') FROM ch_epoch_raw w WHERE w.epoch = r.epoch AND w.byte_offset < r.raw_bytes))))
  FROM ch_revisions r JOIN ch_epochs e ON e.id = r.epoch WHERE r.session_id = $1 AND r.revision = $2
$snapshot$, false) \gset d_ignored_

-- Plan (read-only): epoch revisions whose bound exceeds the cap are built exactly; those PostgreSQL rejects cannot be
-- downgraded.
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT set_config('down024.over_bound', coalesce(string_agg(format('%s|%s|%s', r.session_id, r.revision, :snapshot_bound), E'\n' ORDER BY r.session_id, r.revision), ''), false)
FROM ch_revisions r JOIN ch_epochs e ON e.id = r.epoch WHERE :snapshot_bound > :jsonb_cap \gset d_ignored_
DO $$
DECLARE
  candidate text;
  rejected text := '';
  accepted integer := 0;
  size integer;
  state text;
BEGIN
  FOREACH candidate IN ARRAY array_remove(string_to_array(current_setting('down024.over_bound'), E'\n'), '') LOOP
    BEGIN
      EXECUTE 'SELECT pg_column_size(snapshot) FROM (' || current_setting('down024.snapshot') || ') built(snapshot)'
        INTO size USING split_part(candidate, '|', 1)::uuid, split_part(candidate, '|', 2)::integer;
      accepted := accepted + 1;
    EXCEPTION WHEN program_limit_exceeded OR out_of_memory THEN
      GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE;
      rejected := rejected || candidate || '|rejected:' || state || E'\n';
    END;
  END LOOP;
  PERFORM set_config('down024.rejected', rejected, false), set_config('down024.exact_accepted', accepted::text, false);
END $$;
SELECT current_database() AS d_database,
  count(*) AS d_revisions, count(DISTINCT r.session_id) AS d_sources,
  coalesce(sum(r.raw_bytes + r.message_bytes), 0) AS d_copy_bytes,
  -- Measured on the clone copy (U4 rehearsal: 161 revisions, 2.07 GB copied): disk +1.7x, WAL 6.0x (snapshot, message
  -- rows, fragments and their trigram index); a dry-run writes as much WAL as the apply.
  2 * coalesce(sum(r.raw_bytes + r.message_bytes), 0) AS d_disk_bytes, 7 * coalesce(sum(r.raw_bytes + r.message_bytes), 0) AS d_wal_bytes,
  md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s|%s', r.session_id, r.revision, r.epoch, r.message_count, r.record_count,
    r.raw_bytes, r.message_bytes, r.fragment_count, octet_length(e.raw_path)), ',' ORDER BY r.session_id, r.revision), '') || '#' || current_setting('down024.rejected')) AS d_plan
FROM ch_revisions r JOIN ch_epochs e ON e.id = r.epoch \gset
SELECT count(*) AS d_epochs, count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM ch_revisions r WHERE r.epoch = e.id)) AS d_unreferenced FROM ch_epochs e \gset
SELECT (SELECT count(*) FROM ch_epoch_messages) AS d_message_rows, (SELECT count(*) FROM ch_epoch_raw) AS d_raw_rows,
  (SELECT count(*) FROM ch_epoch_records) AS d_record_rows, (SELECT count(*) FROM ch_epoch_fragments) AS d_fragment_rows \gset
SELECT count(*) AS d_over_bound FROM regexp_split_to_table(current_setting('down024.over_bound'), E'\n') l WHERE l <> '' \gset
SELECT count(*) AS d_rejected, count(DISTINCT split_part(l, '|', 1)) AS d_rejected_sources
FROM regexp_split_to_table(current_setting('down024.rejected'), E'\n') l WHERE l <> '' \gset
SELECT (to_regclass('public.ch_uploads') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid = 'public.ch_epochs'::regclass AND attname = 'tail_upload' AND NOT attisdropped)) AS d_s2,
  (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend') AS d_other_clients \gset
\echo DOWN024.database|:d_database
\echo DOWN024.epoch_revisions|:d_revisions
\echo DOWN024.epoch_sources|:d_sources
\echo DOWN024.epochs|:d_epochs
\echo DOWN024.unreferenced_epochs|:d_unreferenced
\echo DOWN024.epoch_rows|messages=:d_message_rows|raw_segments=:d_raw_rows|records=:d_record_rows|fragments=:d_fragment_rows
SELECT 'DOWN024.largest_bound', r.session_id, r.revision, :snapshot_bound FROM ch_revisions r JOIN ch_epochs e ON e.id = r.epoch ORDER BY 4 DESC, 2, 3 LIMIT 1;
\echo DOWN024.over_bound|:d_over_bound
SELECT 'DOWN024.exact_accepted', current_setting('down024.exact_accepted');
SELECT 'DOWN024.non_downgradable', l FROM regexp_split_to_table(current_setting('down024.rejected'), E'\n') WITH ORDINALITY x(l, n) WHERE l <> '' ORDER BY n;
\echo DOWN024.non_downgradable|:d_rejected|sources=:d_rejected_sources
SELECT 'DOWN024.non_downgradable_owner', s.owner, count(*) FROM ch_sources s
WHERE s.id IN (SELECT split_part(l, '|', 1)::uuid FROM regexp_split_to_table(current_setting('down024.rejected'), E'\n') l WHERE l <> '')
GROUP BY s.owner ORDER BY s.owner;
\echo DOWN024.legacy_copy_bytes|:d_copy_bytes
\echo DOWN024.estimate_disk_bytes|:d_disk_bytes
\echo DOWN024.estimate_wal_bytes|:d_wal_bytes
SELECT 'DOWN024.s2_objects', :'d_s2'::boolean::integer;
\echo DOWN024.other_clients|:d_other_clients
\echo DOWN024.plan|:d_plan
-- COMMIT, not ROLLBACK: the plan's settings (set_config) survive only a transaction that ends normally.
COMMIT;
\if :d_preflight
\echo DOWN024.result|preflight-complete
\quit
\endif

-- dry-run and apply: refusals before the first change.
\if :d_s2
\echo DOWN024.result|refused-s2-present
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: S2 upload objects exist; run the S2 down-script first'; END $$;
\endif
SELECT :d_other_clients > 0 AS d_busy, :'d_plan' = :'expect_plan' AS d_plan_matches, :d_rejected > 0 AS d_non_downgradable,
  :'confirm_purge_sources' = :'d_rejected_sources' AS d_purge_count_matches \gset
\if :d_busy
\echo DOWN024.result|refused-active-connections|:d_other_clients
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: other clients are connected to the database; stop the server first'; END $$;
\endif
\if :d_apply
\if :d_plan_matches
\else
\echo DOWN024.result|refused-stale-plan
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: expect_plan is not the plan of this database; run preflight again'; END $$;
\endif
\endif
\if :d_non_downgradable
\if :d_purge
\if :d_purge_count_matches
\else
\echo DOWN024.result|refused-purge-count|sources=:d_rejected_sources
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: confirm_purge_sources is not the number of sources the preflight lists'; END $$;
\endif
\else
\echo DOWN024.result|refused-non-downgradable|:d_rejected|sources=:d_rejected_sources
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: revisions above the jsonb cap cannot be downgraded; stay on S1, or purge their sources whole (purge_non_downgradable=yes confirm_purge_sources=<S>)'; END $$;
\endif
\elif :d_purge
\echo DOWN024.result|refused-nothing-to-purge
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: purge_non_downgradable given, but every revision can be downgraded'; END $$;
\endif

\if :d_apply
\echo DOWN024.backup|:backup_reference
SELECT set_config('down024.commit', 'on', false), set_config('down024.max_sources', :'max_sources', false) \gset d_ignored_
\else
SELECT set_config('down024.commit', 'off', false), set_config('down024.max_sources', :'max_sources', false) \gset d_ignored_
BEGIN;
\endif

-- The chosen purge, as the owner's Purge does it (tombstone, generations, jobs, revisions), in the first transaction.
\if :d_purge
\if :d_apply
BEGIN;
\endif
CREATE TEMPORARY TABLE down024_purged ON COMMIT DROP AS
  SELECT DISTINCT split_part(l, '|', 1)::uuid AS id FROM regexp_split_to_table(current_setting('down024.rejected'), E'\n') l WHERE l <> '';
UPDATE ch_sources SET tombstone = true, published = NULL WHERE id IN (SELECT id FROM down024_purged);
DELETE FROM ch_chunks WHERE generation IN (SELECT id FROM ch_generations WHERE session_id IN (SELECT id FROM down024_purged));
DELETE FROM ch_generations WHERE session_id IN (SELECT id FROM down024_purged);
DELETE FROM ch_jobs WHERE session_id IN (SELECT id FROM down024_purged);
DELETE FROM ch_revisions WHERE session_id IN (SELECT id FROM down024_purged);
SELECT 'DOWN024.purged_sources', count(*) FROM down024_purged;
\if :d_apply
COMMIT;
\endif
\endif

-- Conversion, one source at a time (one transaction each in apply).
DO $$
DECLARE
  limit_sources integer := nullif(current_setting('down024.max_sources'), '')::integer;
  committing boolean := current_setting('down024.commit') = 'on';
  sources integer := 0;
  revisions integer := 0;
  source uuid;
  head integer;
  item record;
  covered bigint;
  first_ordinal integer;
  built jsonb;
BEGIN
  LOOP
    EXIT WHEN limit_sources IS NOT NULL AND sources >= limit_sources;
    source := (SELECT session_id FROM ch_revisions WHERE epoch IS NOT NULL ORDER BY session_id LIMIT 1);
    EXIT WHEN source IS NULL;
    SELECT revision INTO head FROM ch_sources WHERE id = source FOR UPDATE;
    ALTER TABLE ch_revisions DISABLE TRIGGER ch_immutable_revision;
    FOR item IN SELECT revision, epoch, message_count, raw_bytes FROM ch_revisions WHERE session_id = source AND epoch IS NOT NULL ORDER BY revision LOOP
      covered := (SELECT coalesce(sum(octet_length(content)), 0) FROM ch_epoch_raw WHERE epoch = item.epoch AND byte_offset < item.raw_bytes);
      IF covered <> item.raw_bytes OR EXISTS(SELECT 1 FROM ch_epoch_raw WHERE epoch = item.epoch AND byte_offset < item.raw_bytes AND byte_offset + octet_length(content) > item.raw_bytes) THEN
        RAISE EXCEPTION 'down-024: raw segments of revision % of % do not end at its raw_bytes', item.revision, source;
      END IF;
      INSERT INTO ch_messages(session_id, revision, position, message_id, value)
        SELECT source, item.revision, position, message_id, value FROM ch_epoch_messages WHERE epoch = item.epoch AND position < item.message_count;
      GET DIAGNOSTICS covered = ROW_COUNT;
      IF covered <> item.message_count THEN
        RAISE EXCEPTION 'down-024: revision % of % has % of its % messages', item.revision, source, covered, item.message_count;
      END IF;
      -- After the revision's metadata fragments, its message fragments in position order (no reader uses ordinals).
      first_ordinal := (SELECT coalesce(max(f.ordinal) + 1, 0) FROM ch_archive_fragments f WHERE f.session_id = source AND f.revision = item.revision);
      INSERT INTO ch_archive_fragments(session_id, revision, ordinal, value, head_candidate)
        SELECT source, item.revision, first_ordinal + row_number() OVER (ORDER BY f.position, f.part) - 1, f.value, item.revision = head
        FROM ch_epoch_fragments f WHERE f.epoch = item.epoch AND f.position < item.message_count;
      EXECUTE current_setting('down024.snapshot') INTO built USING source, item.revision;
      UPDATE ch_revisions SET snapshot = built, epoch = NULL, envelope = NULL, message_count = NULL, record_count = NULL,
        raw_bytes = NULL, message_bytes = NULL, fragment_count = NULL, raw_state = NULL, message_chain = NULL, message_time = NULL
      WHERE session_id = source AND revision = item.revision;
      revisions := revisions + 1;
    END LOOP;
    ALTER TABLE ch_revisions ENABLE TRIGGER ch_immutable_revision;
    -- Unreferenced now: if S1 runs again before the layout is removed, its upkeep clears their search candidates.
    UPDATE ch_epochs SET candidates = 'prune' WHERE session_id = source AND candidates = 'current';
    sources := sources + 1;
    IF committing THEN
      COMMIT;
    END IF;
  END LOOP;
  PERFORM set_config('down024.converted_sources', sources::text, false), set_config('down024.converted_revisions', revisions::text, false);
END $$;
SELECT 'DOWN024.converted_sources', current_setting('down024.converted_sources');
SELECT 'DOWN024.converted_revisions', current_setting('down024.converted_revisions');
SELECT count(*) AS d_remaining, count(*) = 0 AS d_converted FROM ch_revisions WHERE epoch IS NOT NULL \gset

-- The layout itself, once no epoch revision remains: one transaction.
\if :d_converted
\if :d_apply
BEGIN;
\endif
LOCK TABLE ch_revisions IN ACCESS EXCLUSIVE MODE;
SELECT NOT EXISTS(SELECT 1 FROM ch_revisions WHERE epoch IS NOT NULL) AS d_still_converted \gset
\if :d_still_converted
\else
\echo DOWN024.result|refused-concurrent-epoch-revision
DO $$ BEGIN RAISE EXCEPTION 'down-024 refused: an epoch revision appeared; stop the server and run preflight again'; END $$;
\endif
ALTER TABLE ch_revisions DROP CONSTRAINT ch_revisions_layout;
DROP INDEX ch_revisions_epoch;
ALTER TABLE ch_revisions DROP COLUMN epoch, DROP COLUMN envelope, DROP COLUMN message_count, DROP COLUMN record_count,
  DROP COLUMN raw_bytes, DROP COLUMN message_bytes, DROP COLUMN fragment_count, DROP COLUMN raw_state,
  DROP COLUMN message_chain, DROP COLUMN message_time;
ALTER TABLE ch_revisions ALTER COLUMN snapshot SET NOT NULL;
DROP TABLE ch_epoch_fragments, ch_epoch_records, ch_epoch_raw, ch_epoch_messages, ch_epochs;
-- S1's index of the HEAD switch (migration 017 creates it at every start of S1; a start cut before 017 leaves none).
DROP INDEX IF EXISTS ch_archive_fragments_session_candidates;
DROP FUNCTION ch_immutable_epoch(), ch_immutable_epoch_rows(), ch_epoch_rows_guard();
-- The body of migration 013.
CREATE OR REPLACE FUNCTION ch_immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.binding_id IS DISTINCT FROM OLD.binding_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
    RAISE EXCEPTION 'immutable archive revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DELETE FROM ch_schema_migrations WHERE version = 24;
\if :d_apply
COMMIT;
\echo DOWN024.result|applied
\else
ROLLBACK;
\echo DOWN024.result|dry-run-rolled-back
\endif
\else
\if :d_apply
\echo DOWN024.result|incomplete|remaining=:d_remaining
DO $$ BEGIN RAISE EXCEPTION 'down-024 incomplete: epoch revisions remain; run preflight again and apply with its new plan token'; END $$;
\else
ROLLBACK;
\echo DOWN024.dry_run_remaining|:d_remaining
\echo DOWN024.result|dry-run-rolled-back
\endif
\endif
