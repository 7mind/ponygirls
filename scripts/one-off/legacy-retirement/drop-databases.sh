#!/bin/sh
# Drop of the four rollback database copies: a separate, separately confirmed step (never part of run.sh).
# POSIX shell + psql only; psql sessions on standard input (`PSQL` or PG* variables; op.sh supplies both).
# Connect to the maintenance database `postgres`, never to a database that is to be dropped.
#
# Only the four rollback copies named below can ever be dropped (exact equality). Everything about the object is
# decided by ONE guard (`guard_sql`), evaluated on the database identified by OID on every path:
#   - the OID must exist (absent: "already gone" when neither the name nor its tombstone exists; refused otherwise);
#   - it must be named either NAME (fresh) or lr_drop_<OID> (tombstone) and nothing else;
#   - a tombstone must carry exactly the provenance this script writes in its rename transaction,
#     `legacy-retirement drop: original=NAME oid=<OID> at=<UTC time>`, and refuse connections (ALLOW_CONNECTIONS false,
#     CONNECTION LIMIT 0); a fresh copy must accept connections normally and carry no such comment;
#   - neither NAME nor the tombstone name may be a service database or a configured one (--configured-databases);
#   - not a template, not the connected database, no other backend on that OID, no write during the sample window.
#
#   drop-databases.sh [plan] --configured-databases LIST
#       read-only: the guard verdict for each of the four copies (`DB.would_drop` / `DB.refuse` / `DB.gone`), every
#       tombstone with its provenance and the exact continue / restore commands, and every other database as
#       `DB.stays`. Last line: DB.result|plan-complete-nothing-dropped
#   drop-databases.sh drop --drop NAME --confirm-database NAME --expect-oid OID --configured-databases LIST
#       1. guard; one transaction: RENAME to lr_drop_<OID>, ALLOW_CONNECTIONS false CONNECTION LIMIT 0, COMMENT ON
#          DATABASE (provenance), guard again (tombstone state); commit.        (skipped when resuming a tombstone)
#       2. guard (tombstone state); DROP DATABASE lr_drop_<OID>; check that the OID is gone.
#       Last line: DB.result|dropped, or DB.result|already-gone|oid=<OID> when the OID was already absent
#       (an earlier run dropped it but its confirmation was lost). After a cut, re-run the same command: it resumes
#       under the same guard; a refusal prints the exact OID-checked commands to continue or restore.
#
#   --configured-databases LIST  comma-separated database names the deployed services are configured to use (op.sh
#                        reads them from the ConfigMaps). Required; the script cannot learn them from the database.
#   --sample-seconds N   write-activity sample (default 10): pg_stat_database write counters of the OID compared
#                        across N seconds. Supplementary evidence only (it sees the window only); refused outright
#                        when track_counts is off.
#
# Exit status: 0 success; 2 usage; 3 refusal.
set -eu
ROLLBACK_COPIES='chronicle_nex249_import_20261105a chronicle_nex249_bootstrap_20261106 haystack_nex249_before_20261105a manure_nex249_before_20261105a'
SERVICE_DATABASES='chronicle haystack manure postgres'
PROVENANCE_PREFIX='legacy-retirement drop:'
usage() { sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
fail() { printf 'drop-databases: %s\n' "$1" >&2; exit 2; }
nl='
'
whole() {
  case $1 in *"$nl"*|*"$(printf '\r')"*) return 1 ;; esac
  [ "$(printf '%s' "$1" | LC_ALL=C tr -d '[:cntrl:]')" = "$1" ] && printf '%s' "$1" | LC_ALL=C grep -Eq "^$2\$"
}
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
refuse() { printf 'drop-databases refused: %s\n' "$1" >&2; exit 3; }
whole "$sample" '[1-9][0-9]{0,2}' || fail '--sample-seconds must be 1..999'
[ "$configured_given" = t ] || refuse '--configured-databases LIST is required (the databases the deployed services use; op.sh reads them from the ConfigMaps)'
whole "$configured" '[a-z_][a-z0-9_]{0,62}(,[a-z_][a-z0-9_]{0,62})*' || fail '--configured-databases must be a comma-separated list of database names'
configured_list=$(printf '%s' "$configured" | tr ',' ' ')
for c in $configured_list; do member "$c" "$ROLLBACK_COPIES" && refuse "$c is one of the rollback copies but a service is configured to use it"; done
protected=$(printf '%s' "$SERVICE_DATABASES $configured_list" | tr ' ' ',')
copies_csv=$(printf '%s' "$ROLLBACK_COPIES" | tr ' ' ',')

header() { printf '%s\n' '\set ON_ERROR_STOP on' '\pset pager off' '\pset format unaligned' '\pset tuples_only on' "\\pset fieldsep '|'" "SET lock_timeout = '5s';" "SET statement_timeout = '120s';" "SET idle_in_transaction_session_timeout = '120s';" "SET application_name = 'lr:drop-databases:$mode';"
  printf "SELECT set_config('dd.copies', '%s', false), set_config('dd.protected', '%s', false), set_config('dd.prefix', '%s', false) \\\\gset dd_ignored_\n" "$copies_csv" "$protected" "$PROVENANCE_PREFIX"
  printf '%s\n' "DO \$\$ BEGIN IF current_setting('track_counts') <> 'on' THEN RAISE EXCEPTION 'drop-databases refused: track_counts is off, no write evidence is available'; END IF; END \$\$;"; }
# Write sample keyed by OID (survives a rename): sets dd.written to the OIDs whose counters changed.
sample_sql() {
  counters="coalesce(string_agg(datid::text || '=' || md5(row(tup_inserted, tup_updated, tup_deleted, xact_commit, conflicts, deadlocks, stats_reset)::text), ',' ORDER BY datid), '')"
  printf '%s\n' "SELECT pg_stat_clear_snapshot();" "SELECT $counters AS dd_s1 FROM pg_stat_database WHERE datid <> 0 \\gset" \
    "SELECT pg_sleep($sample);" "SELECT pg_stat_clear_snapshot();" "SELECT $counters AS dd_s2 FROM pg_stat_database WHERE datid <> 0 \\gset" \
    "SELECT coalesce(string_agg(b.d, ',' ORDER BY b.d), '') AS dd_written FROM (SELECT split_part(e, '=', 1) AS d, split_part(e, '=', 2) AS h FROM unnest(string_to_array(:'dd_s2', ',')) e) b LEFT JOIN (SELECT split_part(e, '=', 1) AS d, split_part(e, '=', 2) AS h FROM unnest(string_to_array(:'dd_s1', ',')) e) a USING (d) WHERE a.h IS DISTINCT FROM b.h \\gset" \
    "SELECT set_config('dd.written', :'dd_written', false) \\gset dd_ignored_"
}
# THE guard. Inputs (settings): dd.name, dd.oid, dd.expect ('any' | 'tombstone'), dd.copies, dd.protected,
# dd.prefix, dd.written. Output: dd.state = fresh | tombstone | gone; refusals raise with the reason.
guard_sql() {
  cat <<'SQL'
DO $$
DECLARE
  name text := current_setting('dd.name'); want bigint := current_setting('dd.oid')::bigint;
  tomb text := 'lr_drop_' || current_setting('dd.oid'); obj record; n bigint; prov text;
BEGIN
  IF NOT name = ANY (string_to_array(current_setting('dd.copies'), ',')) THEN
    RAISE EXCEPTION 'drop-databases refused: % is not one of the rollback copies', name; END IF;
  IF name = ANY (string_to_array(current_setting('dd.protected'), ',')) OR tomb = ANY (string_to_array(current_setting('dd.protected'), ',')) THEN
    RAISE EXCEPTION 'drop-databases refused: % or % is a service or configured database', name, tomb; END IF;
  SELECT d.oid, d.datname, d.datistemplate, d.datallowconn, d.datconnlimit, shobj_description(d.oid, 'pg_database') AS note
    INTO obj FROM pg_database d WHERE d.oid::bigint = want;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM pg_database WHERE datname IN (name, tomb)) THEN
      RAISE EXCEPTION 'drop-databases refused: OID % is absent but % or % exists under another OID; run plan again', want, name, tomb; END IF;
    PERFORM set_config('dd.state', 'gone', false); RETURN;
  END IF;
  IF obj.datistemplate THEN RAISE EXCEPTION 'drop-databases refused: OID % is a template database', want; END IF;
  IF obj.datname = current_database() THEN RAISE EXCEPTION 'drop-databases refused: connected to the database that is to be dropped'; END IF;
  prov := current_setting('dd.prefix') || ' original=' || name || ' oid=' || want || ' at=';
  IF obj.datname = name THEN
    IF current_setting('dd.expect') = 'tombstone' THEN RAISE EXCEPTION 'drop-databases refused: OID % is still named %, not its tombstone', want, name; END IF;
    IF NOT obj.datallowconn OR obj.datconnlimit <> -1 THEN
      RAISE EXCEPTION 'drop-databases refused: % has connections disabled or limited by someone else (allow=%, limit=%)', name, obj.datallowconn, obj.datconnlimit; END IF;
    IF obj.note LIKE current_setting('dd.prefix') || '%' THEN
      RAISE EXCEPTION 'drop-databases refused: % carries a drop provenance comment but is not a tombstone', name; END IF;
    IF EXISTS (SELECT 1 FROM pg_database WHERE datname = tomb) THEN
      RAISE EXCEPTION 'drop-databases refused: % exists next to %', tomb, name; END IF;
    PERFORM set_config('dd.state', 'fresh', false);
  ELSIF obj.datname = tomb THEN
    IF obj.note IS NULL OR left(obj.note, length(prov)) <> prov OR substr(obj.note, length(prov) + 1) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' THEN
      RAISE EXCEPTION 'drop-databases refused: % does not carry the provenance "%<time>" written by this script for %; it is not resumed', tomb, prov, name; END IF;
    IF obj.datallowconn OR obj.datconnlimit <> 0 THEN
      RAISE EXCEPTION 'drop-databases refused: tombstone % accepts connections (allow=%, limit=%)', tomb, obj.datallowconn, obj.datconnlimit; END IF;
    IF EXISTS (SELECT 1 FROM pg_database WHERE datname = name) THEN
      RAISE EXCEPTION 'drop-databases refused: both % and its tombstone % exist', name, tomb; END IF;
    PERFORM set_config('dd.state', 'tombstone', false);
  ELSE
    RAISE EXCEPTION 'drop-databases refused: OID % is named %, neither % nor %', want, obj.datname, name, tomb;
  END IF;
  SELECT count(*) INTO n FROM pg_stat_activity WHERE datid = obj.oid AND pid <> pg_backend_pid();
  IF n > 0 THEN RAISE EXCEPTION 'drop-databases refused: % connection(s) to OID %', n, want; END IF;
  IF obj.oid::text = ANY (string_to_array(current_setting('dd.written'), ',')) THEN
    RAISE EXCEPTION 'drop-databases refused: OID % was written to during the sample window', want; END IF;
END $$;
SQL
}
# Exact OID- and provenance-checked commands to continue or restore a tombstone (printed locally on refusals and for each
# tombstone in the plan; nothing here is executed by this script).
manual() { # name oid
  printf '%s\n' "DB.manual|continue the drop: drop-databases.sh drop --drop $1 --confirm-database $1 --expect-oid $2 --configured-databases <LIST>" \
    "DB.manual|restore instead (psql on the maintenance database, one transaction):" \
    "DB.manual|  BEGIN; DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'lr_drop_$2' AND oid = $2 AND shobj_description(oid, 'pg_database') LIKE '$PROVENANCE_PREFIX original=$1 oid=$2 at=%') THEN RAISE EXCEPTION 'lr_drop_$2 is not the tombstone of $1 (OID $2) written by drop-databases.sh'; END IF; END \$\$;" \
    "DB.manual|  ALTER DATABASE lr_drop_$2 RENAME TO $1; ALTER DATABASE $1 ALLOW_CONNECTIONS true CONNECTION LIMIT -1; COMMENT ON DATABASE $1 IS NULL; COMMIT;"
}
run_session() { printf '%s\n' "$1" | ${PSQL:-psql} -X -q -v ON_ERROR_STOP=1 -f -; }

case $mode in
  plan)
    [ "$dropflag" = f ] || usage
    session=$(header; sample_sql
      for name in $ROLLBACK_COPIES; do
        printf "SELECT coalesce((SELECT oid::text FROM pg_database WHERE datname = '%s'), (SELECT substr(datname, 9) FROM pg_database WHERE shobj_description(oid, 'pg_database') LIKE '%s original=%s oid=%%' AND datname ~ '^lr_drop_[0-9]+\$' LIMIT 1), '0') AS dd_oid \\\\gset\n" "$name" "$PROVENANCE_PREFIX" "$name"
        printf "SELECT set_config('dd.name', '%s', false), set_config('dd.oid', :'dd_oid', false), set_config('dd.expect', 'any', false), set_config('dd.state', '-', false) \\\\gset dd_ignored_\n" "$name"
        printf '%s\n' "SELECT :'dd_oid' = '0' AS dd_absent \\gset" '\if :dd_absent' "\\echo DB.gone|$name|0|no database of this name and no tombstone with its provenance" '\else'
        # the guard writes nothing; with ON_ERROR_STOP off a refusal is printed and becomes the DB.refuse verdict
        printf '%s\n' "\\set ON_ERROR_STOP off"
        guard_sql
        printf '%s\n' "SELECT CASE WHEN current_setting('dd.state') IN ('fresh','tombstone') THEN 'DB.would_drop' WHEN current_setting('dd.state') = 'gone' THEN 'DB.gone' END, '$name', :'dd_oid', current_setting('dd.state'), coalesce((SELECT pg_database_size(:'dd_oid'::oid)), 0) WHERE current_setting('dd.state') <> '-';" \
          "SELECT 'DB.refuse', '$name', :'dd_oid', 'see the refusal above' WHERE current_setting('dd.state', true) = '-';" "\\set ON_ERROR_STOP on" '\endif'
      done
      printf '%s\n' "SELECT 'DB.tombstone', d.datname, d.oid, coalesce(shobj_description(d.oid, 'pg_database'), '-') FROM pg_database d WHERE d.datname ~ '^lr_drop_[0-9]+\$' ORDER BY 2;" \
        "SELECT 'DB.stays', d.datname, pg_database_size(d.oid), (SELECT count(*) FROM pg_stat_activity a WHERE a.datid = d.oid) FROM pg_database d WHERE NOT d.datistemplate AND d.datname <> ALL (string_to_array(current_setting('dd.copies'), ',')) AND d.datname !~ '^lr_drop_[0-9]+\$' ORDER BY 2;"
      printf '%s\n' '\echo DB.result|plan-complete-nothing-dropped')
    out=$(run_session "$session" 2>&1) || { printf '%s\n' "$out"; exit 3; }
    printf '%s\n' "$out" | grep -v '^DB.result|' || true
    printf '%s\n' "$out" | grep '^DB.tombstone|' | while IFS='|' read -r _ tname toid tnote; do
      orig=$(printf '%s' "$tnote" | sed -n 's/^legacy-retirement drop: original=\([a-z0-9_]*\) oid=[0-9]* at=.*$/\1/p')
      if [ -n "$orig" ]; then manual "$orig" "$toid"; else echo "DB.manual|$tname has no provenance of this script: not ours to continue or restore; investigate"; fi
    done
    printf '%s\n' "$out" | grep '^DB.result|' ;;
  drop)
    [ "$dropflag" = t ] || refuse 'drop requires --drop NAME (without it nothing is dropped; run plan first)'
    member "$target" "$SERVICE_DATABASES" && refuse "$target is a live service database"
    member "$target" "$configured_list" && refuse "$target is configured as a service database"
    member "$target" "$ROLLBACK_COPIES" || refuse "$target is not one of the four rollback copies ($ROLLBACK_COPIES)"
    [ "$confirm" = "$target" ] || refuse '--confirm-database must repeat the database name exactly'
    whole "$oid" '[1-9][0-9]{0,9}' || refuse '--expect-oid OID (from plan) is required'
    session=$(header; sample_sql
      printf "SELECT set_config('dd.name', '%s', false), set_config('dd.oid', '%s', false), set_config('dd.expect', 'any', false) \\\\gset dd_ignored_\n" "$target" "$oid"
      guard_sql
      printf '%s\n' "SELECT current_setting('dd.state') = 'gone' AS dd_gone, current_setting('dd.state') = 'fresh' AS dd_fresh \\gset" \
        '\if :dd_gone' "\\echo DB.already_gone|oid=$oid|absent" "\\echo DB.result|already-gone|oid=$oid" '\q' '\endif' \
        '\if :dd_fresh' 'BEGIN;'
      printf "SELECT format('ALTER DATABASE %%I RENAME TO %%I', '%s', 'lr_drop_%s') AS dd_rename, format('ALTER DATABASE %%I ALLOW_CONNECTIONS false CONNECTION LIMIT 0', 'lr_drop_%s') AS dd_disable, format('COMMENT ON DATABASE %%I IS %%L', 'lr_drop_%s', '%s original=%s oid=%s at=' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')) AS dd_comment \\\\gset\n" "$target" "$oid" "$oid" "$oid" "$PROVENANCE_PREFIX" "$target" "$oid"
      printf '%s\n' ':dd_rename;' ':dd_disable;' ':dd_comment;' "SELECT set_config('dd.expect', 'tombstone', false) \\gset dd_ignored_"
      guard_sql
      printf '%s\n' 'COMMIT;' "\\echo DB.tombstoned|$target|lr_drop_$oid" '\endif' "\\echo DB.phase|between-rename-and-drop" \
        "SELECT set_config('dd.expect', 'tombstone', false) \\gset dd_ignored_"
      guard_sql
      printf '%s\n' "\\echo DB.dropping|lr_drop_$oid" "DROP DATABASE lr_drop_$oid;" \
        "SELECT 'DB.remaining_oid', count(*) FROM pg_database WHERE oid = $oid;" \
        "SELECT count(*) = 0 AS dd_dropped FROM pg_database WHERE oid = $oid \\gset" \
        '\if :dd_dropped' '\echo DB.result|dropped' '\else' "DO \$\$ BEGIN RAISE EXCEPTION 'drop-databases: OID $oid still exists after DROP'; END \$\$;" '\endif')
    if run_session "$session"; then exit 0; fi
    echo "DB.manual|the drop of $target (OID $oid) did not complete. Only if plan lists lr_drop_$oid as a tombstone of $target (provenance), either:"
    manual "$target" "$oid"
    echo "DB.result|refused"
    exit 3 ;;
  *) usage ;;
esac
