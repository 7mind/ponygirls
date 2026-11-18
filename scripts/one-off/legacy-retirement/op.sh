#!/usr/bin/env bash
# Operator wrapper for the production run of the legacy retirement (plan section 7). It builds the exec-path psql
# command for each target's OWN database, exports it as PSQL for run.sh / drop-databases.sh, and records the
# restart counts of the database pod's containers before and after every command (a session of ours must not
# coincide with a service restart unnoticed; plan 7.1, rehearsal report §12.0).
#
# Settings (environment; all required; closed alphabets, single line). Values are in the deployment repository:
#   LR_CONTEXT    kube context              LR_NAMESPACE  namespace           LR_POD   database pod
#   LR_CONTAINER  PostgreSQL container      LR_SOCKET     unix socket directory inside that container
#   LR_ROLE       database role of the maintenance session (peer authentication on the socket)
#
# Commands:
#   op.sh <chronicle|haystack|manure> <run.sh mode> [run.sh options]   e.g. op.sh chronicle preflight
#   op.sh drop [plan | drop --drop NAME --confirm-database NAME --expect-oid OID]
#         drop-databases.sh on the maintenance database `postgres`, with --configured-databases taken from the
#         services' ConfigMaps (fails closed when a ConfigMap or its JDBC URL cannot be read)
#   op.sh backup-chronicle NAME     CREATE DATABASE NAME TEMPLATE chronicle STRATEGY FILE_COPY on the maintenance
#         database; NAME must be lr_backup_chronicle_<YYYYMMDDHHMM>; PostgreSQL refuses while anyone is connected
#         to chronicle (stop or fence the service first). Prints the copy's OID and size.
#   op.sh backup-haystack FILE      pg_dump of haystack through the exec path into a new local FILE (mode 0600);
#         accepted only when the archive decodes completely (pg_restore --file=/dev/null); prints bytes and sha256
#   op.sh codec-check               check-stored-documents.sh against haystack (needs nix develop .#chronicle)
#   op.sh restarts                  only the restart counts
# Output ends with the wrapped command's own end marker (LR.result|… / DB.result|…); the exit status of a broken
# exec stream is not evidence of completion.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
fail() { printf 'op: %s\n' "$1" >&2; exit 2; }
single() { [[ $1 != *$'\n'* && $1 != *$'\r'* && $1 =~ ^$2$ ]]; }
for v in LR_CONTEXT LR_NAMESPACE LR_POD LR_CONTAINER LR_ROLE; do
  single "${!v:-}" '[A-Za-z0-9][A-Za-z0-9._-]{0,252}' || fail "$v must be set (single line, [A-Za-z0-9._-])"
done
single "${LR_SOCKET:-}" '/[A-Za-z0-9._/-]{1,200}' || fail 'LR_SOCKET must be an absolute socket directory path'
K=(kubectl "--context=$LR_CONTEXT" -n "$LR_NAMESPACE")
psql_for() { printf 'kubectl --context=%s -n %s exec -i %s -c %s -- psql -h %s -U %s -d %s' "$LR_CONTEXT" "$LR_NAMESPACE" "$LR_POD" "$LR_CONTAINER" "$LR_SOCKET" "$LR_ROLE" "$1"; }
restarts() {
  local json; json=$("${K[@]}" --request-timeout=30s get pod "$LR_POD" -o json 2>/dev/null) || { echo "LR.restarts|$1|unavailable"; return 1; }
  python3 -c 'import json,sys
d=json.loads(sys.argv[2]); print("LR.restarts|"+sys.argv[1]+"|"+" ".join(f"{c[\"name\"]}={c[\"restartCount\"]}" for c in d["status"]["containerStatuses"]))' "$1" "$json"
}
before=''; after=''
wrap() { # runs "$@", printing restart counts before and after and any change
  before=$(restarts before); echo "$before"
  "$@"; local rc=$?
  after=$(restarts after); echo "$after"
  if [[ ${before#LR.restarts|before|} != "${after#LR.restarts|after|}" ]]; then
    echo "LR.restarts.changed|before:${before#LR.restarts|before|}|after:${after#LR.restarts|after|}"
    echo 'op: a container restart count changed during this command: check the service before continuing' >&2
  fi
  return $rc
}
configured_databases() {
  local svc json names=()
  for svc in chronicle haystack manure; do
    json=$("${K[@]}" --request-timeout=30s get configmap "$svc" -o json 2>/dev/null) || { echo "op: cannot read ConfigMap $svc" >&2; return 1; }
    local db; db=$(python3 -c 'import json,re,sys
cfg=json.loads(json.loads(sys.argv[1])["data"]["server.json"])
urls=set()
def walk(x):
    if isinstance(x,dict): [walk(v) for v in x.values()]
    elif isinstance(x,list): [walk(v) for v in x]
    elif isinstance(x,str):
        m=re.fullmatch(r"jdbc:postgresql://[^/]+/([a-z_][a-z0-9_]{0,62})",x)
        if m: urls.add(m.group(1))
walk(cfg); print(",".join(sorted(urls)))' "$json" 2>/dev/null) || { echo "op: ConfigMap $svc is not readable JSON" >&2; return 1; }
    [[ -n $db ]] || { echo "op: no JDBC URL in ConfigMap $svc" >&2; return 1; }
    names+=("$db")
  done
  (IFS=,; echo "${names[*]}")
}
[[ $# -ge 1 ]] || fail 'usage: op.sh <chronicle|haystack|manure> <mode> [options] | drop … | backup-chronicle NAME | backup-haystack FILE | codec-check | restarts'
cmd=$1; shift
case $cmd in
  chronicle|haystack|manure)
    [[ $# -ge 1 ]] || fail "usage: op.sh $cmd <run.sh mode> [options]"
    export PSQL; PSQL=$(psql_for "$cmd")
    wrap sh "$here/run.sh" "$cmd" "$@" ;;
  drop)
    dbs=$(configured_databases) || fail 'the configured service databases could not be read (refusing)'
    echo "LR.configured_databases|$dbs"
    export PSQL; PSQL=$(psql_for postgres)
    wrap sh "$here/drop-databases.sh" "$@" --configured-databases "$dbs" ;;
  backup-chronicle)
    [[ $# -eq 1 ]] && single "$1" 'lr_backup_chronicle_[0-9]{12}' || fail 'backup-chronicle NAME, NAME = lr_backup_chronicle_<YYYYMMDDHHMM>'
    name=$1
    backup() {
      printf '%s\n' '\set ON_ERROR_STOP on' "SET application_name = 'lr:backup:chronicle';" "SET statement_timeout = 0;" \
        "SELECT 'LR.backup.source', oid, pg_database_size(oid) FROM pg_database WHERE datname = 'chronicle';" \
        "CREATE DATABASE $name TEMPLATE chronicle STRATEGY FILE_COPY;" \
        "SELECT 'LR.backup.copy', datname, oid, pg_database_size(oid) FROM pg_database WHERE datname = '$name';" \
        '\echo LR.result|backup-created' | $(psql_for postgres) -X -q -At -F '|' -v ON_ERROR_STOP=1 -f -
    }
    wrap backup ;;
  backup-haystack)
    [[ $# -eq 1 ]] && single "$1" '/[A-Za-z0-9._/-]{1,200}' || fail 'backup-haystack FILE (absolute path of a new local file)'
    file=$1; [[ ! -e $file && ! -e $file.partial ]] || fail "$file exists"
    command -v pg_restore >/dev/null || fail 'pg_restore is required locally (nix develop .#chronicle)'
    dump() {
      (umask 077; "${K[@]}" exec "$LR_POD" -c "$LR_CONTAINER" -- env PGAPPNAME=lr:backup:haystack pg_dump -h "$LR_SOCKET" -U "$LR_ROLE" --lock-wait-timeout=10s --format=custom -d haystack >"$file.partial") || { echo 'op: pg_dump failed' >&2; return 3; }
      pg_restore --list "$file.partial" >/dev/null && pg_restore --exit-on-error --file=/dev/null "$file.partial" || { echo 'op: the archive does not decode to the end (incomplete): not a backup' >&2; return 3; }
      mv "$file.partial" "$file"
      echo "LR.backup.file|$file|$(stat -c %s "$file")|$(sha256sum "$file" | cut -d' ' -f1)"
      echo 'LR.result|backup-decoded-completely'
    }
    wrap dump ;;
  codec-check)
    export PSQL; PSQL=$(psql_for haystack)
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    TMPDIR=$tmp wrap sh "$here/check-stored-documents.sh" ;;
  restarts) restarts now ;;
  *) fail "unknown command $cmd" ;;
esac
