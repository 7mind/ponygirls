#!/bin/sh
# Drop of rollback database copies: a separate, separately confirmed step (never part of run.sh).
# POSIX shell + psql only; one psql session on standard input, like run.sh (`PSQL` or PG* variables).
# Connect to a maintenance database (for example `postgres`), never to a database that is to be dropped.
#
#   drop-databases.sh preflight NAME [NAME...]
#       read-only: for each named database whether it exists, its OID, size and connections; and every other
#       database of the cluster, so that what stays is visible.
#   drop-databases.sh drop NAME --confirm-database NAME --expect-oid OID
#       drops exactly one database. Refuses unless: the name is typed twice, it is not one of the live databases
#       chronicle, haystack, manure, postgres, the database exists, it is not the connected one and not a template,
#       nobody is connected to it, and its OID is the one preflight printed
#       (the OID identifies the object: a database re-created under the same name has another one).
#
# Output: `DB.<key>|…` lines. Exit status: 0 success; 2 usage; 3 refusal.
set -eu
usage() { sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
fail() { printf 'drop-databases: %s\n' "$1" >&2; exit 2; }
name_ok() { printf '%s' "$1" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$'; }
[ $# -ge 2 ] || usage
mode=$1; shift
header() { printf '%s\n' '\set ON_ERROR_STOP on' '\pset pager off' '\pset format unaligned' '\pset tuples_only on' "\\pset fieldsep '|'" "SET lock_timeout = '5s';" "SET statement_timeout = '120s';"; }
case $mode in
  preflight)
    list=''
    for name in "$@"; do name_ok "$name" || fail "unexpected database name: $name"; list="$list${list:+,}('$name')"; done
    session=$(header
      printf '%s\n' "SELECT 'DB.connected', current_database();"
      printf '%s\n' "SELECT 'DB.named', n.name, CASE WHEN d.oid IS NULL THEN 'absent' ELSE 'present' END, coalesce(d.oid::bigint, 0), coalesce(pg_database_size(d.oid), 0), (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = n.name), coalesce(d.datistemplate, false) FROM (VALUES $list) n(name) LEFT JOIN pg_database d ON d.datname = n.name ORDER BY 2;"
      printf '%s\n' "SELECT 'DB.stays', d.datname, pg_database_size(d.oid), (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname) FROM pg_database d WHERE NOT d.datistemplate AND d.datname NOT IN (SELECT name FROM (VALUES $list) n(name)) ORDER BY 2;"
      printf '%s\n' '\echo DB.result|preflight-complete') ;;
  drop)
    name=$1; shift; confirm=''; oid=''
    while [ $# -gt 0 ]; do
      case $1 in
        --confirm-database) [ $# -ge 2 ] || usage; confirm=$2; shift 2 ;;
        --expect-oid) [ $# -ge 2 ] || usage; oid=$2; shift 2 ;;
        *) usage ;;
      esac
    done
    name_ok "$name" || fail "unexpected database name: $name"
    # The live databases are never a rollback copy; the OID check alone does not stop a mistyped live name
    # (observed in the rehearsal: the live-name refusal case dropped the clone's `haystack`).
    case $name in chronicle|haystack|manure|postgres) printf 'drop-databases refused: %s is a live database of the deployment\n' "$name" >&2; exit 3 ;; esac
    [ "$confirm" = "$name" ] || fail '--confirm-database must repeat the database name'
    printf '%s' "$oid" | grep -Eq '^[1-9][0-9]{0,9}$' || fail '--expect-oid OID (from preflight) is required'
    session=$(header
      printf "\\\\set name '%s'\n\\\\set oid %s\n" "$name" "$oid"
      cat <<'SQL'
SELECT set_config('dd.name', :'name', false), set_config('dd.oid', :'oid', false) \gset dd_ignored_
DO $$
DECLARE target record; n bigint;
BEGIN
  SELECT oid, datistemplate INTO target FROM pg_database WHERE datname = current_setting('dd.name');
  IF NOT FOUND THEN RAISE EXCEPTION 'drop-databases refused: database % does not exist', current_setting('dd.name'); END IF;
  IF current_setting('dd.name') = current_database() THEN RAISE EXCEPTION 'drop-databases refused: connected to the database that is to be dropped'; END IF;
  IF target.datistemplate THEN RAISE EXCEPTION 'drop-databases refused: % is a template database', current_setting('dd.name'); END IF;
  SELECT count(*) INTO n FROM pg_stat_activity WHERE datname = current_setting('dd.name');
  IF n > 0 THEN RAISE EXCEPTION 'drop-databases refused: % connection(s) to %', n, current_setting('dd.name'); END IF;
  IF target.oid::bigint <> current_setting('dd.oid')::bigint THEN
    RAISE EXCEPTION 'drop-databases refused: % has OID %, not the expected %; run preflight again', current_setting('dd.name'), target.oid, current_setting('dd.oid');
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
