#!/bin/sh
# Drop of the four rollback database copies: a separate, separately confirmed step (never part of run.sh).
# POSIX shell + psql only; psql sessions on standard input, like run.sh (`PSQL` or PG* variables; op.sh supplies
# both). Connect to the maintenance database `postgres`, never to a database that is to be dropped.
#
# The script takes no free-form database names: it only ever acts on the four rollback copies named below
# (decision Q96 D / Q98), compared for exact equality. Any other name is refused, the live service databases
# explicitly, and so is any copy that a service is configured to use or is connected to.
#
#   drop-databases.sh [plan] --configured-databases LIST
#       default, read-only: for each of the four copies whether it exists, its OID and size, its connections, the
#       write-activity sample, and the verdict `DB.would_drop` or `DB.refuse` with the reason; an existing tombstone
#       of an interrupted drop; then every other database as `DB.stays`. Nothing is dropped.
#   drop-databases.sh drop --drop NAME --confirm-database NAME --expect-oid OID --configured-databases LIST
#       drops exactly one of the four copies, in two steps that bind the dropped object to the checked OID:
#       1. one transaction: the refusal checks, then `ALTER DATABASE NAME RENAME TO lr_drop_<OID>` and
#          `ALLOW_CONNECTIONS false CONNECTION LIMIT 0`, then a check that lr_drop_<OID> has that OID; commit.
#          (RENAME itself refuses while anyone is connected.)
#       2. re-check that lr_drop_<OID> is that OID, `DROP DATABASE lr_drop_<OID>`, then verify the OID is gone.
#       If the session ends between the steps, the same command resumes from the tombstone (NAME is then absent).
#       Undo after step 1: `ALTER DATABASE lr_drop_<OID> RENAME TO NAME;
#                           ALTER DATABASE NAME ALLOW_CONNECTIONS true CONNECTION LIMIT -1;`
#
#   --configured-databases LIST  comma-separated database names the deployed services are configured to use (op.sh
#                        reads them from the services' ConfigMaps). Required: without it the script refuses (it cannot
#                        learn the configured bindings from inside the database). Connected bindings are read live
#                        from pg_stat_activity (any backend of any role on the copy refuses).
#   --sample-seconds N   length of the write-activity sample (default 10): a write counter of pg_stat_database
#                        (tup_inserted/updated/deleted, xact_commit, conflicts, deadlocks, stats_reset) that changes
#                        between two samples refuses. Supplementary evidence only: it can only see writes inside the
#                        window, and it refuses outright when track_counts is off (no evidence at all).
#
# Output: `DB.<key>|…` lines; the last line of a complete run is `DB.result|…`. Exit status: 0 success; 2 usage;
# 3 refusal.
set -eu
ROLLBACK_COPIES='chronicle_nex249_import_20261105a chronicle_nex249_bootstrap_20261106 haystack_nex249_before_20261105a manure_nex249_before_20261105a'
SERVICE_DATABASES='chronicle haystack manure postgres'
usage() { sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
fail() { printf 'drop-databases: %s\n' "$1" >&2; exit 2; }
refuse() { printf 'drop-databases refused: %s\n' "$1" >&2; exit 3; }
nl='
'
# Whole-value validation: no line break or control character anywhere, then the pattern over the whole value.
whole() {
  case $1 in *"$nl"*|*"$(printf '\r')"*) return 1 ;; esac
  [ "$(printf '%s' "$1" | LC_ALL=C tr -d '[:cntrl:]')" = "$1" ] && printf '%s' "$1" | LC_ALL=C grep -Eq "^$2\$"
}
# Exact equality with one entry of a space-separated list (a value containing a space is never an entry).
member() { _v=$1; for _e in $2; do [ "$_v" = "$_e" ] && return 0; done; return 1; }
for copy in $ROLLBACK_COPIES; do member "$copy" "$SERVICE_DATABASES" && fail "internal: $copy is both a rollback copy and a service database"; done

mode=plan; case ${1:-} in plan|drop) mode=$1; shift ;; esac
target=''; dropflag=f; confirm=''; oid=''; sample=10; configured=''; configured_given=f
while [ $# -gt 0 ]; do
  case $1 in
    --drop) [ $# -ge 2 ] || usage; dropflag=t; target=$2; shift 2 ;;
    --confirm-database) [ $# -ge 2 ] || usage; confirm=$2; shift 2 ;;
    --expect-oid) [ $# -ge 2 ] || usage; oid=$2; shift 2 ;;
    --sample-seconds) [ $# -ge 2 ] || usage; sample=$2; shift 2 ;;
    --configured-databases) [ $# -ge 2 ] || usage; configured=$2; configured_given=t; shift 2 ;;
    *) usage ;;
  esac
done
whole "$sample" '[1-9][0-9]{0,2}' || fail '--sample-seconds must be 1..999'
[ "$configured_given" = t ] || refuse '--configured-databases LIST is required (the databases the deployed services use; op.sh reads them from the ConfigMaps)'
whole "$configured" '[a-z_][a-z0-9_]{0,62}(,[a-z_][a-z0-9_]{0,62})*' || fail '--configured-databases must be a comma-separated list of database names'
configured_list=$(printf '%s' "$configured" | tr ',' ' ')
for c in $configured_list; do member "$c" "$ROLLBACK_COPIES" && refuse "$c is one of the rollback copies but a service is configured to use it"; done
header() { printf '%s\n' '\set ON_ERROR_STOP on' '\pset pager off' '\pset format unaligned' '\pset tuples_only on' "\\pset fieldsep '|'" "SET lock_timeout = '5s';" "SET statement_timeout = '120s';" "SET idle_in_transaction_session_timeout = '120s';" "SET application_name = 'lr:drop-databases:$mode';"; }
values() { v=''; for n in $1; do v="$v${v:+,}('$n')"; done; printf '%s' "$v"; }
# Statistics must be collected, or the write sample is empty evidence: refuse (fail closed).
stats_guard() { printf '%s\n' "DO \$\$ BEGIN IF current_setting('track_counts') <> 'on' THEN RAISE EXCEPTION 'drop-databases refused: track_counts is off, no write evidence is available'; END IF; END \$\$;"; }
# Two samples of the write counters, the stats snapshot cleared before each; no temp objects. Sets dd.written.
sample_sql() {
  counters="coalesce(string_agg(datname || '=' || md5(row(tup_inserted, tup_updated, tup_deleted, xact_commit, conflicts, deadlocks, stats_reset)::text), ',' ORDER BY datname), '')"
  printf '%s\n' "SELECT pg_stat_clear_snapshot();" "SELECT $counters AS dd_s1 FROM pg_stat_database WHERE datname IS NOT NULL \\gset" \
    "SELECT pg_sleep($sample);" "SELECT pg_stat_clear_snapshot();" "SELECT $counters AS dd_s2 FROM pg_stat_database WHERE datname IS NOT NULL \\gset" \
    "SELECT coalesce(string_agg(b.d, ',' ORDER BY b.d), '') AS dd_written FROM (SELECT split_part(e, '=', 1) AS d, split_part(e, '=', 2) AS h FROM unnest(string_to_array(:'dd_s2', ',')) e) b LEFT JOIN (SELECT split_part(e, '=', 1) AS d, split_part(e, '=', 2) AS h FROM unnest(string_to_array(:'dd_s1', ',')) e) a USING (d) WHERE a.h IS DISTINCT FROM b.h \\gset" \
    "SELECT set_config('dd.written', :'dd_written', false) \\gset dd_ignored_"
}
copies=$(values "$ROLLBACK_COPIES"); services=$(values "$SERVICE_DATABASES $configured_list")
case $mode in
  plan)
    session=$(header; stats_guard; sample_sql
      cat <<SQL
SELECT 'DB.connected', current_database();
WITH n(name) AS (VALUES $copies), s(name) AS (VALUES $services),
x AS (
  SELECT n.name, d.oid, coalesce(pg_database_size(d.oid), 0) AS bytes, coalesce(d.datistemplate, false) AS template,
         (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = n.name AND a.pid <> pg_backend_pid()) AS connections,
         n.name = ANY (string_to_array(current_setting('dd.written'), ',')) AS written
  FROM n LEFT JOIN pg_database d ON d.datname = n.name)
SELECT CASE WHEN x.oid IS NULL OR x.template OR x.connections > 0 OR x.written OR x.name = current_database()
             OR x.name IN (SELECT name FROM s) THEN 'DB.refuse' ELSE 'DB.would_drop' END,
       x.name, coalesce(x.oid::bigint, 0), x.bytes, x.connections, x.written,
       CASE WHEN x.oid IS NULL THEN 'absent' WHEN x.name IN (SELECT name FROM s) THEN 'service-database'
            WHEN x.name = current_database() THEN 'connected-database' WHEN x.template THEN 'template'
            WHEN x.connections > 0 THEN 'connections' WHEN x.written THEN 'written-during-sample' ELSE 'ok' END
FROM x ORDER BY 2;
SELECT 'DB.tombstone', d.datname, d.oid, pg_database_size(d.oid) FROM pg_database d WHERE d.datname ~ '^lr_drop_[0-9]+\$' ORDER BY 2;
SELECT 'DB.stays', d.datname, pg_database_size(d.oid), (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname)
FROM pg_database d WHERE NOT d.datistemplate AND d.datname NOT IN (SELECT name FROM (VALUES $copies) n(name)) AND d.datname !~ '^lr_drop_[0-9]+\$' ORDER BY 2;
\echo DB.result|plan-complete-nothing-dropped
SQL
    ) ;;
  drop)
    [ "$dropflag" = t ] || refuse 'drop requires --drop NAME (without it nothing is dropped; run plan first)'
    member "$target" "$SERVICE_DATABASES" && refuse "$target is a live service database"
    member "$target" "$configured_list" && refuse "$target is configured as a service database"
    member "$target" "$ROLLBACK_COPIES" || refuse "$target is not one of the four rollback copies ($ROLLBACK_COPIES)"
    [ "$confirm" = "$target" ] || refuse '--confirm-database must repeat the database name exactly'
    whole "$oid" '[1-9][0-9]{0,9}' || refuse '--expect-oid OID (from plan) is required'
    tomb="lr_drop_$oid"
    session=$(header; stats_guard; sample_sql
      printf "\\\\set name '%s'\n\\\\set oid %s\n\\\\set tomb '%s'\n" "$target" "$oid" "$tomb"
      printf "SELECT set_config('dd.services', '%s', false) \\\\gset dd_ignored_\n" "$(printf '%s' "$SERVICE_DATABASES $configured_list" | tr ' ' ',')"
      cat <<'SQL'
SELECT set_config('dd.name', :'name', false), set_config('dd.oid', :'oid', false), set_config('dd.tomb', :'tomb', false) \gset dd_ignored_
-- Step 1 (one transaction): checks on NAME, rename to the OID-bound tombstone, disable connections, re-check the OID.
BEGIN;
DO $$
DECLARE target record; n bigint; tomb_oid oid;
BEGIN
  SELECT oid INTO tomb_oid FROM pg_database WHERE datname = current_setting('dd.tomb');
  IF FOUND THEN
    -- resuming an interrupted drop: NAME must be gone and the tombstone must be the checked OID
    IF tomb_oid::bigint <> current_setting('dd.oid')::bigint THEN
      RAISE EXCEPTION 'drop-databases refused: % exists with OID %, not %', current_setting('dd.tomb'), tomb_oid, current_setting('dd.oid');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_database WHERE datname = current_setting('dd.name')) THEN
      RAISE EXCEPTION 'drop-databases refused: both % and its tombstone exist', current_setting('dd.name');
    END IF;
    RETURN;
  END IF;
  SELECT oid, datistemplate INTO target FROM pg_database WHERE datname = current_setting('dd.name');
  IF NOT FOUND THEN RAISE EXCEPTION 'drop-databases refused: database % does not exist', current_setting('dd.name'); END IF;
  IF current_setting('dd.name') = current_database() THEN RAISE EXCEPTION 'drop-databases refused: connected to the database that is to be dropped'; END IF;
  IF current_setting('dd.name') = ANY (string_to_array(current_setting('dd.services'), ',')) THEN RAISE EXCEPTION 'drop-databases refused: % is a service database', current_setting('dd.name'); END IF;
  IF target.datistemplate THEN RAISE EXCEPTION 'drop-databases refused: % is a template database', current_setting('dd.name'); END IF;
  IF target.oid::bigint <> current_setting('dd.oid')::bigint THEN
    RAISE EXCEPTION 'drop-databases refused: % has OID %, not the expected %; run plan again', current_setting('dd.name'), target.oid, current_setting('dd.oid');
  END IF;
  SELECT count(*) INTO n FROM pg_stat_activity WHERE datname = current_setting('dd.name') AND pid <> pg_backend_pid();
  IF n > 0 THEN RAISE EXCEPTION 'drop-databases refused: % connection(s) to %', n, current_setting('dd.name'); END IF;
  IF current_setting('dd.name') = ANY (string_to_array(current_setting('dd.written'), ',')) THEN
    RAISE EXCEPTION 'drop-databases refused: % was written to during the sample window', current_setting('dd.name');
  END IF;
  EXECUTE format('ALTER DATABASE %I RENAME TO %I', current_setting('dd.name'), current_setting('dd.tomb'));
  EXECUTE format('ALTER DATABASE %I ALLOW_CONNECTIONS false CONNECTION LIMIT 0', current_setting('dd.tomb'));
  SELECT oid INTO tomb_oid FROM pg_database WHERE datname = current_setting('dd.tomb');
  IF tomb_oid IS DISTINCT FROM target.oid THEN RAISE EXCEPTION 'drop-databases refused: the renamed database is not the checked OID'; END IF;
END $$;
COMMIT;
\echo DB.tombstoned|:name|:tomb
\echo DB.phase|between-rename-and-drop
-- Step 2: the tombstone name is unique to this OID and accepts no connections. Re-check, drop, verify.
SELECT (SELECT oid::bigint FROM pg_database WHERE datname = :'tomb') IS NOT DISTINCT FROM :oid AS dd_same \gset
\if :dd_same
\else
DO $$ BEGIN RAISE EXCEPTION 'drop-databases refused: the tombstone no longer names the checked OID'; END $$;
\endif
\echo DB.dropping|:tomb
DROP DATABASE :"tomb";
SELECT 'DB.remaining_oid', count(*) FROM pg_database WHERE oid = :oid;
SELECT count(*) = 0 AS dd_gone FROM pg_database WHERE oid = :oid \gset
\if :dd_gone
\echo DB.result|dropped
\else
DO $$ BEGIN RAISE EXCEPTION 'drop-databases: the checked OID still exists after DROP'; END $$;
\endif
SQL
    ) ;;
  *) usage ;;
esac
# shellcheck disable=SC2086
printf '%s\n' "$session" | ${PSQL:-psql} -X -q -v ON_ERROR_STOP=1 -f -
