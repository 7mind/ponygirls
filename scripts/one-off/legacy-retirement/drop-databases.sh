#!/bin/sh
# Drop of the four rollback database copies: a separate, separately confirmed step (never part of run.sh).
# POSIX shell + psql only; one psql session on standard input, like run.sh (`PSQL` or PG* variables).
# Connect to the maintenance database `postgres`, never to a database that is to be dropped.
#
# The script takes no free-form database names: it only ever acts on the four rollback copies named below
# (decision Q96 D / Q98). Any other name is refused, the live service databases explicitly.
#
#   drop-databases.sh [plan]
#       default, read-only: for each of the four copies whether it exists, its OID and size, its connections,
#       whether it was written to during a sample window, and the verdict `DB.would_drop` or `DB.refuse` with the
#       reason; then every other database of the cluster as `DB.stays`. Nothing is dropped.
#   drop-databases.sh drop --drop NAME --confirm-database NAME --expect-oid OID
#       drops exactly one of the four copies. Refuses unless: NAME is one of the four and typed twice, it is not a
#       live service database, it exists with the OID the plan printed, it is not the connected database and not a
#       template, nobody else is connected to it, and it was not written to during the sample window.
#
#   --sample-seconds N   length of the write-activity window (default 10). "Written to" means that a write
#                        counter of pg_stat_database (tup_inserted, tup_updated, tup_deleted, xact_commit,
#                        conflicts, deadlocks, stats_reset) differs between two samples N seconds apart, each
#                        taken after pg_stat_clear_snapshot(). No temporary objects are created.
#
# Output: `DB.<key>|…` lines. Exit status: 0 success; 2 usage; 3 refusal.
set -eu
ROLLBACK_COPIES='chronicle_nex249_import_20261105a chronicle_nex249_bootstrap_20261106 haystack_nex249_before_20261105a manure_nex249_before_20261105a'
SERVICE_DATABASES='chronicle haystack manure postgres'
usage() { sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
fail() { printf 'drop-databases: %s\n' "$1" >&2; exit 2; }
refuse() { printf 'drop-databases refused: %s\n' "$1" >&2; exit 3; }
in_list() { case " $2 " in *" $1 "*) return 0 ;; esac; return 1; }
for copy in $ROLLBACK_COPIES; do in_list "$copy" "$SERVICE_DATABASES" && fail "internal: $copy is both a rollback copy and a service database"; done

mode=plan; case ${1:-} in plan|drop) mode=$1; shift ;; esac
target=''; dropflag=f; confirm=''; oid=''; sample=10
while [ $# -gt 0 ]; do
  case $1 in
    --drop) [ $# -ge 2 ] || usage; dropflag=t; target=$2; shift 2 ;;
    --confirm-database) [ $# -ge 2 ] || usage; confirm=$2; shift 2 ;;
    --expect-oid) [ $# -ge 2 ] || usage; oid=$2; shift 2 ;;
    --sample-seconds) [ $# -ge 2 ] || usage; sample=$2; shift 2 ;;
    *) usage ;;
  esac
done
printf '%s' "$sample" | grep -Eq '^[1-9][0-9]{0,2}$' || fail '--sample-seconds must be 1..999'
header() { printf '%s\n' '\set ON_ERROR_STOP on' '\pset pager off' '\pset format unaligned' '\pset tuples_only on' "\\pset fieldsep '|'" "SET lock_timeout = '5s';" "SET statement_timeout = '120s';" "SET application_name = 'lr:drop-databases:$mode';"; }
values() { v=''; for n in $1; do v="$v${v:+,}('$n')"; done; printf '%s' "$v"; }
# Two samples of the write counters of every database, the stats snapshot cleared before each; no temp objects.
# Result: psql variable dd_written (comma list of databases whose counters changed) and setting dd.written.
sample_sql() {
  counters="coalesce(string_agg(datname || '=' || md5(row(tup_inserted, tup_updated, tup_deleted, xact_commit, conflicts, deadlocks, stats_reset)::text), ',' ORDER BY datname), '')"
  printf '%s\n' "SELECT pg_stat_clear_snapshot();" "SELECT $counters AS dd_s1 FROM pg_stat_database WHERE datname IS NOT NULL \\gset" \
    "SELECT pg_sleep($sample);" "SELECT pg_stat_clear_snapshot();" "SELECT $counters AS dd_s2 FROM pg_stat_database WHERE datname IS NOT NULL \\gset" \
    "SELECT coalesce(string_agg(b.d, ',' ORDER BY b.d), '') AS dd_written FROM (SELECT split_part(e, '=', 1) AS d, split_part(e, '=', 2) AS h FROM unnest(string_to_array(:'dd_s2', ',')) e) b LEFT JOIN (SELECT split_part(e, '=', 1) AS d, split_part(e, '=', 2) AS h FROM unnest(string_to_array(:'dd_s1', ',')) e) a USING (d) WHERE a.h IS DISTINCT FROM b.h \\gset" \
    "SELECT set_config('dd.written', :'dd_written', false) \\gset dd_ignored_"
}
case $mode in
  plan)
    copies=$(values "$ROLLBACK_COPIES"); services=$(values "$SERVICE_DATABASES")
    session=$(header; sample_sql
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
SELECT 'DB.stays', d.datname, pg_database_size(d.oid), (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname)
FROM pg_database d WHERE NOT d.datistemplate AND d.datname NOT IN (SELECT name FROM (VALUES $copies) n(name)) ORDER BY 2;
\echo DB.result|plan-complete-nothing-dropped
SQL
    ) ;;
  drop)
    [ "$dropflag" = t ] || refuse 'drop requires --drop NAME (without it nothing is dropped; run plan first)'
    in_list "$target" "$SERVICE_DATABASES" && refuse "$target is a live service database"
    in_list "$target" "$ROLLBACK_COPIES" || refuse "$target is not one of the four rollback copies ($ROLLBACK_COPIES)"
    [ "$confirm" = "$target" ] || refuse '--confirm-database must repeat the database name exactly'
    printf '%s' "$oid" | grep -Eq '^[1-9][0-9]{0,9}$' || refuse '--expect-oid OID (from plan) is required'
    session=$(header; sample_sql
      printf "\\\\set name '%s'\n\\\\set oid %s\n" "$target" "$oid"
      cat <<'SQL'
SELECT set_config('dd.name', :'name', false), set_config('dd.oid', :'oid', false) \gset dd_ignored_
DO $$
DECLARE target record; n bigint;
BEGIN
  SELECT oid, datistemplate INTO target FROM pg_database WHERE datname = current_setting('dd.name');
  IF NOT FOUND THEN RAISE EXCEPTION 'drop-databases refused: database % does not exist', current_setting('dd.name'); END IF;
  IF current_setting('dd.name') = current_database() THEN RAISE EXCEPTION 'drop-databases refused: connected to the database that is to be dropped'; END IF;
  IF target.datistemplate THEN RAISE EXCEPTION 'drop-databases refused: % is a template database', current_setting('dd.name'); END IF;
  IF target.oid::bigint <> current_setting('dd.oid')::bigint THEN
    RAISE EXCEPTION 'drop-databases refused: % has OID %, not the expected %; run plan again', current_setting('dd.name'), target.oid, current_setting('dd.oid');
  END IF;
  SELECT count(*) INTO n FROM pg_stat_activity WHERE datname = current_setting('dd.name') AND pid <> pg_backend_pid();
  IF n > 0 THEN RAISE EXCEPTION 'drop-databases refused: % connection(s) to %', n, current_setting('dd.name'); END IF;
  IF current_setting('dd.name') = ANY (string_to_array(current_setting('dd.written'), ',')) THEN
    RAISE EXCEPTION 'drop-databases refused: % was written to during the sample window', current_setting('dd.name');
  END IF;
END $$;
\echo DB.dropping|:name
DROP DATABASE :"name";
SELECT 'DB.remaining', count(*) FROM pg_database WHERE datname = :'name';
\echo DB.result|dropped
SQL
    ) ;;
  *) usage ;;
esac
# shellcheck disable=SC2086
printf '%s\n' "$session" | ${PSQL:-psql} -X -q -v ON_ERROR_STOP=1 -f -
