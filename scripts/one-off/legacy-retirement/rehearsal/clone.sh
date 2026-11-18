#!/usr/bin/env bash
# Rehearsal clone of production databases on this host (plan section 8). Runs on the operator's host.
# The clone holds REAL session content: it lives only in one private directory (mode 0700) and is deleted afterwards.
#
#   clone.sh export  --dir DIR DATABASE [DATABASE...]
#       Read-only at the source: one `pg_dump --format=custom` per database, streamed into DIR/dumps.
#       SOURCE_PG_DUMP is the complete pg_dump command line AT THE SOURCE without the database argument, for example
#       an exec into the database pod (`kubectl … exec -i POD -c CONTAINER -- pg_dump -h SOCKETDIR -U ROLE`).
#       Default: `pg_dump` with the PG* variables. CLONE_COMPRESS (default 1) is pg_dump's --compress value
#       (0 = compress nowhere, e.g. to keep CPU off the source host). The archive must pass `pg_restore --list`.
#   clone.sh init-cluster --dir DIR        initdb + start a scratch PostgreSQL in DIR: unix socket for psql, and
#                                          127.0.0.1:${CLONE_PORT:-54329} with a generated password for the binary
#   clone.sh start-cluster --dir DIR       start the existing scratch cluster again (same listeners)
#   Listeners: CLONE_SOCKET_DIR (default DIR/s; must be an existing 0700 directory of the current user) and
#   CLONE_LISTEN (default 127.0.0.1; the empty string means unix socket only). Pass the same values to every mode.
#   clone.sh restore --dir DIR [--jobs N] DATABASE [DATABASE...]      createdb + pg_restore into that cluster
#   clone.sh env --dir DIR                 prints the PGHOST/PGPORT/PGUSER lines for run.sh against the clone
#   clone.sh stop-cluster --dir DIR
#   clone.sh delete --dir DIR --confirm DIR
#       Removes DIR entirely (dumps, cluster, anything the rehearsal wrote there). Refuses while the cluster runs
#       and for any directory this script did not create.
#
# export/init-cluster/start-cluster/restore/stop-cluster need POSTGRES_HOME (PostgreSQL 18 with pgvector: `nix develop .#chronicle`).
set -euo pipefail
usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
fail() { printf 'clone: %s\n' "$1" >&2; exit 3; }
[[ $# -ge 1 ]] || usage
mode=$1; shift
dir=''; confirm=''; jobs=4; databases=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir) [[ $# -ge 2 ]] || usage; dir=$2; shift 2 ;;
    --confirm) [[ $# -ge 2 ]] || usage; confirm=$2; shift 2 ;;
    --jobs) [[ $# -ge 2 ]] || usage; jobs=$2; shift 2 ;;
    -*) usage ;;
    *) databases+=("$1"); shift ;;
  esac
done
[[ -n $dir && $dir = /* ]] || fail '--dir must be an absolute path'
[[ $jobs =~ ^[1-9][0-9]?$ ]] || fail '--jobs must be 1..99'
for database in "${databases[@]}"; do [[ $database =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail "unexpected database name: $database"; done
marker=$dir/LEGACY-RETIREMENT-CLONE
umask 077
private() {
  [[ -d $dir && -f $marker && ! -L $dir ]] || fail "$dir is not a clone directory created by this script"
  [[ $(stat -c '%a %u' "$dir") == "700 $(id -u)" ]] || fail "$dir must be mode 0700 and owned by the current user"
}
pg() { : "${POSTGRES_HOME:?POSTGRES_HOME required (nix develop .#chronicle)}"; local tool=$1; shift; "$POSTGRES_HOME/bin/$tool" "$@"; }
socket=${CLONE_SOCKET_DIR:-$dir/s}; port=${CLONE_PORT:-54329}; listen=${CLONE_LISTEN-127.0.0.1}
[[ $socket = /* ]] || fail 'CLONE_SOCKET_DIR must be an absolute path'
[[ -z $listen || $listen == 127.0.0.1 ]] || fail 'CLONE_LISTEN must be 127.0.0.1 or empty'
start_cluster() {
  if [[ $socket != "$dir/s" ]]; then
    [[ -d $socket && ! -L $socket && $(stat -c '%a %u' "$socket") == "700 $(id -u)" ]] || fail "$socket must be an existing 0700 directory owned by the current user"
  fi
  pg pg_ctl -D "$dir/pgdata" -l "$dir/server.log" -o "-c listen_addresses='$listen' -k $socket -p $port -c max_wal_size=16GB -c maintenance_work_mem=2GB" -w start >/dev/null
  echo "cluster started; socket $socket; tcp ${listen:-none}${listen:+:$port} (jdbc:postgresql://127.0.0.1:$port/<database> user postgres, password file $dir/password)"
}
[[ $port =~ ^[1-9][0-9]{3,4}$ ]] || fail 'CLONE_PORT must be a port number'
case $mode in
  export)
    [[ ${#databases[@]} -ge 1 ]] || usage
    if [[ ! -e $dir ]]; then mkdir -m 700 "$dir"; printf 'created %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$marker"; fi
    private; mkdir -p "$dir/dumps"
    for database in "${databases[@]}"; do
      [[ ! -e $dir/dumps/$database.dump ]] || fail "$database is already exported"
      start=$(date +%s)
      # pg_dump reads inside one REPEATABLE READ, READ ONLY transaction; nothing is written at the source.
      # shellcheck disable=SC2086
      rc=0; ${SOURCE_PG_DUMP:-pg_dump} --format=custom --compress="${CLONE_COMPRESS:-1}" --no-owner --no-privileges --dbname="$database" >"$dir/dumps/$database.dump.partial" || rc=$?
      [[ $rc -eq 0 ]] || fail "$database: pg_dump exited with status $rc"
      # A complete custom-format archive has a readable table of contents; a cut stream does not.
      pg pg_restore --list "$dir/dumps/$database.dump.partial" >/dev/null || fail "$database: the dump stream is incomplete"
      mv "$dir/dumps/$database.dump.partial" "$dir/dumps/$database.dump"
      printf '%s %s bytes=%s seconds=%s sha256=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$database" "$(stat -c %s "$dir/dumps/$database.dump")" "$(( $(date +%s) - start ))" "$(sha256sum "$dir/dumps/$database.dump" | cut -d' ' -f1)" | tee -a "$dir/MANIFEST"
    done ;;
  init-cluster)
    private; [[ ! -e $dir/pgdata ]] || fail 'the cluster already exists'
    [[ $socket != "$dir/s" ]] || mkdir "$socket"
    # Two ways in, both private: the unix socket in this 0700 directory (trust: only this user can reach it), and
    # loopback TCP for the service binary's JDBC driver, which requires the generated password (scram-sha-256).
    head -c 24 /dev/urandom | base64 | tr -d '/+=' >"$dir/password"
    pg initdb -D "$dir/pgdata" -U postgres --auth-local=trust --auth-host=scram-sha-256 --pwfile="$dir/password" --no-locale --encoding=UTF8 >"$dir/initdb.log"
    start_cluster ;;
  start-cluster)
    private; [[ -d $dir/pgdata && ! -e $dir/pgdata/postmaster.pid ]] || fail 'no stopped cluster in this directory'
    start_cluster ;;
  env)
    private; printf 'export PGHOST=%s PGPORT=%s PGUSER=postgres\n' "$socket" "$port" ;;
  restore)
    private; [[ ${#databases[@]} -ge 1 ]] || usage
    for database in "${databases[@]}"; do
      [[ -f $dir/dumps/$database.dump ]] || fail "no dump of $database"
      start=$(date +%s)
      pg psql -X -q -v ON_ERROR_STOP=1 -h "$socket" -p "$port" -U postgres -d postgres -c "CREATE DATABASE \"$database\""
      pg pg_restore --no-owner --no-privileges --jobs "$jobs" --exit-on-error -h "$socket" -p "$port" -U postgres -d "$database" "$dir/dumps/$database.dump"
      pg psql -X -q -v ON_ERROR_STOP=1 -h "$socket" -p "$port" -U postgres -d "$database" -c 'ANALYZE'
      printf '%s restored %s seconds=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$database" "$(( $(date +%s) - start ))" | tee -a "$dir/MANIFEST"
    done ;;
  stop-cluster)
    private; pg pg_ctl -D "$dir/pgdata" -m fast -w stop >/dev/null; echo 'cluster stopped' ;;
  delete)
    private
    [[ $confirm == "$dir" ]] || fail '--confirm must repeat the directory'
    [[ ! -e $dir/pgdata/postmaster.pid ]] || fail 'the cluster is still running: clone.sh stop-cluster first'
    rm -rf -- "$dir"
    [[ ! -e $dir ]] || fail "$dir still exists"
    echo "deleted $dir" ;;
  *) usage ;;
esac
