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
#       read-only: the guard's verdict for each copy (`DB.would_drop` / `DB.refuse` / `DB.gone`); for each database
#       named lr_drop_<n>, the copy whose tombstone it is according to the same guard (`DB.tombstone_of|COPY|<n>`,
#       with the two possible command lines), or `DB.tombstone_unowned`; every other database as `DB.stays`.
#       Last line: DB.result|plan-complete-nothing-dropped
#   drop-databases.sh drop --drop NAME --confirm-database NAME --expect-oid OID --configured-databases LIST
#       1. guard; one transaction: RENAME to lr_drop_<OID>, ALLOW_CONNECTIONS false CONNECTION LIMIT 0, COMMENT ON
#          DATABASE (provenance), guard again (tombstone state); commit.        (skipped when the guard finds a tombstone)
#       2. guard (tombstone state); DROP DATABASE lr_drop_<OID>; check that the OID is gone.
#       Last line: DB.result|dropped|oid=<OID>, or DB.result|already-gone|oid=<OID> when the OID was already absent.
#   drop-databases.sh restore --oid OID --confirm-database NAME --configured-databases LIST
#       the reverse of step 1 for this script's own tombstone of NAME (guard: tombstone state), in one transaction:
#       RENAME back to NAME, connections allowed again, provenance removed, guard again (fresh state).
#       Last line: DB.result|restored|oid=<OID>
#   After any cut, re-run the same command or run plan; nothing else is needed and no SQL is printed to copy.
#
#   --configured-databases LIST  comma-separated database names the deployed services are configured to use (op.sh
#                        reads them from the ConfigMaps). Required; the script cannot learn them from the database.
#   --sample-seconds N   write-activity sample (default 10): pg_stat_database write counters of the OID compared
#                        across N seconds. Supplementary evidence only (it sees the window only); refused outright
#                        when track_counts is off.
#
# Exit status: 0 success; 2 usage; 3 refusal. A refusal's last line is DB.result|refused.
set -eu
ROLLBACK_COPIES='chronicle_nex249_import_20261105a chronicle_nex249_bootstrap_20261106 haystack_nex249_before_20261105a manure_nex249_before_20261105a'
SERVICE_DATABASES='chronicle haystack manure postgres'
PROVENANCE_PREFIX='legacy-retirement drop:'
usage() { sed -n '2,38p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
fail() { printf 'drop-databases: %s\n' "$1" >&2; exit 2; }
nl='
'
whole() {
  case $1 in *"$nl"*|*"$(printf '\r')"*) return 1 ;; esac
  [ "$(printf '%s' "$1" | LC_ALL=C tr -d '[:cntrl:]')" = "$1" ] && printf '%s' "$1" | LC_ALL=C grep -Eq "^$2\$"
}
member() { _v=$1; for _e in $2; do [ "$_v" = "$_e" ] && return 0; done; return 1; }
for copy in $ROLLBACK_COPIES; do member "$copy" "$SERVICE_DATABASES" && fail "internal: $copy is both a rollback copy and a service database"; done

mode=plan; case ${1:-} in plan|drop|restore) mode=$1; shift ;; esac
target=''; dropflag=f; confirm=''; oid=''; sample=10; configured=''; configured_given=f
while [ $# -gt 0 ]; do
  case $1 in
    --drop) [ $# -ge 2 ] || usage; dropflag=t; target=$2; shift 2 ;;
    --confirm-database) [ $# -ge 2 ] || usage; confirm=$2; shift 2 ;;
    --expect-oid|--oid) [ $# -ge 2 ] || usage; oid=$2; shift 2 ;;
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
  printf "SELECT set_config('dd.copies', '%s', false), set_config('dd.protected', '%s', false), set_config('dd.prefix', '%s', false), set_config('dd.probe', 'f', false), set_config('dd.reason', '', false) \\\\gset dd_ignored_\n" "$copies_csv" "$protected" "$PROVENANCE_PREFIX"
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
 PERFORM set_config('dd.state', '-', false);
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
    IF left(obj.note, length(current_setting('dd.prefix'))) = current_setting('dd.prefix') THEN
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
    IF current_setting('dd.expect') = 'fresh' THEN RAISE EXCEPTION 'drop-databases refused: OID % is a tombstone, expected %', want, name; END IF;
    PERFORM set_config('dd.state', 'tombstone', false);
  ELSE
    RAISE EXCEPTION 'drop-databases refused: OID % is named %, neither % nor %', want, obj.datname, name, tomb;
  END IF;
  SELECT count(*) INTO n FROM pg_stat_activity WHERE datid = obj.oid AND pid <> pg_backend_pid();
  IF n > 0 THEN RAISE EXCEPTION 'drop-databases refused: % connection(s) to OID %', n, want; END IF;
  IF obj.oid::text = ANY (string_to_array(current_setting('dd.written'), ',')) THEN
    RAISE EXCEPTION 'drop-databases refused: OID % was written to during the sample window', want; END IF;
 EXCEPTION WHEN raise_exception THEN
  -- probe mode (plan only): a refusal is a verdict, not an error; on every other path it ends the session
  IF current_setting('dd.probe') = 't' THEN PERFORM set_config('dd.state', 'refused', false); PERFORM set_config('dd.reason', SQLERRM, false);
  ELSE RAISE; END IF;
 END;
END $$;
SQL
}
run_session() { printf '%s\n' "$1" | ${PSQL:-psql} -X -q -v ON_ERROR_STOP=1 -f -; }

case $mode in
  plan)
    [ "$dropflag" = f ] || usage
    session=$(header; sample_sql
      printf '%s\n' "SELECT set_config('dd.probe', 't', false) \\gset dd_ignored_"
      for name in $ROLLBACK_COPIES; do
        printf "SELECT coalesce((SELECT oid::text FROM pg_database WHERE datname = '%s'), '0') AS dd_oid \\\\gset\n" "$name"
        printf '%s\n' "SELECT :'dd_oid' = '0' AS dd_absent \\gset" '\if :dd_absent' "\\echo DB.gone|$name|0|no database of this name" '\else'
        printf "SELECT set_config('dd.name', '%s', false), set_config('dd.oid', :'dd_oid', false), set_config('dd.expect', 'fresh', false) \\\\gset dd_ignored_\n" "$name"
        guard_sql
        printf '%s\n' "SELECT CASE current_setting('dd.state') WHEN 'fresh' THEN 'DB.would_drop' ELSE 'DB.refuse' END, '$name', :'dd_oid', CASE current_setting('dd.state') WHEN 'fresh' THEN pg_database_size(:'dd_oid'::oid)::text ELSE current_setting('dd.reason') END;" '\endif'
      done
      # every database named like a tombstone: its owner is the copy for which the SAME guard accepts it
      printf '%s\n' "SELECT coalesce(string_agg(substr(datname, 9), ' ' ORDER BY datname), '') AS dd_tombs FROM pg_database WHERE datname ~ '^lr_drop_[0-9]{1,10}\$' \\gset" '\echo DB.tombstones|:dd_tombs'
      printf '%s\n' "SELECT 'DB.stays', d.datname, pg_database_size(d.oid), (SELECT count(*) FROM pg_stat_activity a WHERE a.datid = d.oid) FROM pg_database d WHERE NOT d.datistemplate AND d.datname <> ALL (string_to_array(current_setting('dd.copies'), ',')) AND d.datname !~ '^lr_drop_[0-9]+\$' ORDER BY 2;"
      printf '%s\n' '\echo DB.result|plan-complete-nothing-dropped')
    out=$(run_session "$session" 2>&1) || { printf '%s\n' "$out"; echo 'DB.result|refused'; exit 3; }
    printf '%s\n' "$out" | grep -v -e '^DB.result|' -e '^DB.tombstones|' || true
    tombs=$(printf '%s\n' "$out" | sed -n 's/^DB.tombstones|//p')
    for t in $tombs; do
      verdicts=$(header; for name in $ROLLBACK_COPIES; do
          printf "SELECT set_config('dd.probe', 't', false), set_config('dd.written', '', false), set_config('dd.name', '%s', false), set_config('dd.oid', '%s', false), set_config('dd.expect', 'tombstone', false) \\\\gset dd_ignored_\n" "$name" "$t"
          guard_sql
          printf '%s\n' "SELECT 'DB.tombstone_of', '$name', '$t' WHERE current_setting('dd.state') = 'tombstone';"
        done)
      owner=$(run_session "$verdicts" 2>&1 | grep '^DB.tombstone_of|' || true)
      if [ -n "$owner" ] && [ "$(printf '%s\n' "$owner" | wc -l)" -eq 1 ]; then
        copy=$(printf '%s' "$owner" | cut -d'|' -f2)
        echo "$owner"
        echo "DB.tombstone_command|continue|drop-databases.sh drop --drop $copy --confirm-database $copy --expect-oid $t"
        echo "DB.tombstone_command|restore|drop-databases.sh restore --oid $t --confirm-database $copy"
      else
        echo "DB.tombstone_unowned|lr_drop_$t|$t|no copy's guard accepts it as its tombstone: not created by this script (investigate; never dropped or restored by it)"
      fi
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
        '\if :dd_dropped' "\\echo DB.result|dropped|oid=$oid" '\else' "DO \$\$ BEGIN RAISE EXCEPTION 'drop-databases: OID $oid still exists after DROP'; END \$\$;" '\endif')
    run_session "$session" && exit 0
    echo 'DB.result|refused'; exit 3 ;;
  restore)
    [ "$dropflag" = f ] || usage
    target=$confirm
    member "$target" "$SERVICE_DATABASES" && refuse "$target is a live service database"
    member "$target" "$configured_list" && refuse "$target is configured as a service database"
    member "$target" "$ROLLBACK_COPIES" || refuse "restore requires --confirm-database with one of the four rollback copies ($ROLLBACK_COPIES)"
    whole "$oid" '[1-9][0-9]{0,9}' || refuse '--oid OID (from plan) is required'
    session=$(header; sample_sql
      printf "SELECT set_config('dd.name', '%s', false), set_config('dd.oid', '%s', false), set_config('dd.expect', 'tombstone', false) \\\\gset dd_ignored_\n" "$target" "$oid"
      printf '%s\n' 'BEGIN;'
      guard_sql
      printf "SELECT format('ALTER DATABASE %%I RENAME TO %%I', 'lr_drop_%s', '%s') AS dd_rename, format('ALTER DATABASE %%I ALLOW_CONNECTIONS true CONNECTION LIMIT -1', '%s') AS dd_enable, format('COMMENT ON DATABASE %%I IS NULL', '%s') AS dd_uncomment \\\\gset\n" "$oid" "$target" "$target" "$target"
      printf '%s\n' ':dd_rename;' ':dd_enable;' ':dd_uncomment;' "SELECT set_config('dd.expect', 'fresh', false) \\gset dd_ignored_"
      guard_sql
      printf '%s\n' 'COMMIT;' "\\echo DB.result|restored|oid=$oid")
    run_session "$session" && exit 0
    echo 'DB.result|refused'; exit 3 ;;

  *) usage ;;
esac
