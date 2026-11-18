#!/usr/bin/env bash
# Operator wrapper for the production run of the legacy retirement (plan section 7).
#
# Settings (environment; required; single line, closed alphabets; values in the deployment repository):
#   LR_CONTEXT LR_NAMESPACE LR_POD LR_CONTAINER (PostgreSQL container) LR_SOCKET (socket directory in it)
#   LR_ROLE (maintenance role, peer authentication) LR_SYSTEM_IDENTIFIER (confirmed once with `op.sh identify`)
#
# Commands:
#   op.sh identify                    prints pod, namespace and the PostgreSQL system identifier to confirm once
#   op.sh ready                       container readiness and the pod's Ready condition
#   op.sh restarts                    container restart counts
#   op.sh <chronicle|haystack|manure> <run.sh mode> [options]   run.sh against that target's own database
#   op.sh drop [plan | drop --drop NAME --confirm-database NAME --expect-oid OID]   on the maintenance database,
#                                     --configured-databases read from the services' ConfigMaps (strict; fail closed)
#   op.sh backup-haystack FILE        pg_dump of haystack into a new local FILE; accepted only when it decodes completely
#   op.sh backup-chronicle NAME       template copy (not part of the default sequence: decision Q102)
#   op.sh codec-check                 check-stored-documents.sh against haystack (needs nix develop .#chronicle)
#   op.sh check-legacy-free <chronicle|haystack> [psql -v options]   the retained post-deployment check (step 16)
#
# Fail closed. Every remote command runs through ONE function (`checked`): its output is captured and the
# command succeeds only when it exited 0 AND its own success marker is the last non-empty line (a cut stream that
# exits 0 without the marker, or a failure marker, is a failure). Before every command: pod identity, restart counts,
# PostgreSQL system identifier and the Chronicle fence state are probed (a failed probe stops the command before
# anything is sent); while the fence is on, the first output line is "FENCED since …". After every command the
# restart counts are probed again; a failed probe or a changed count makes the command fail (exit 6 / 7).
# Exit status: 0 success; 2 usage/settings; 3 command failed (no success marker); 5 before-probe failed (nothing
# sent); 6 after-probe failed; 7 a container restarted during the command.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
self=$here/op.sh
fail() { printf 'op: %s\n' "$1" >&2; exit 2; }
single() { [[ $1 != *$'\n'* && $1 != *$'\r'* && $1 =~ ^$2$ ]]; }
[[ $# -ge 1 ]] || fail 'usage: see the header of op.sh'
cmd=$1; shift
for v in LR_CONTEXT LR_NAMESPACE LR_POD LR_CONTAINER LR_ROLE; do
  single "${!v:-}" '[A-Za-z0-9][A-Za-z0-9._-]{0,252}' || fail "$v must be set (single line, [A-Za-z0-9._-])"
done
single "${LR_SOCKET:-}" '/[A-Za-z0-9._/-]{1,200}' || fail 'LR_SOCKET must be an absolute socket directory path'
if [[ $cmd != identify ]]; then
  single "${LR_SYSTEM_IDENTIFIER:-}" '[0-9]{1,20}' || fail 'LR_SYSTEM_IDENTIFIER must be set to the value confirmed once with: op.sh identify'
fi
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# --- the only places that name kubectl ------------------------------------------------------------------------------
kube_get() { kubectl "--context=$LR_CONTEXT" -n "$LR_NAMESPACE" --request-timeout=30s get "$@" -o json; }
psql_cmd() { printf 'kubectl --context=%s -n %s exec -i %s -c %s -- psql -h %s -U %s -d %s' "$LR_CONTEXT" "$LR_NAMESPACE" "$LR_POD" "$LR_CONTAINER" "$LR_SOCKET" "$LR_ROLE" "$1"; }
pg_dump_stream() { kubectl "--context=$LR_CONTEXT" -n "$LR_NAMESPACE" exec "$LR_POD" -c "$LR_CONTAINER" -- env PGAPPNAME=lr:backup:haystack pg_dump -h "$LR_SOCKET" -U "$LR_ROLE" --lock-wait-timeout=10s --format=custom -d "$1"; }

# --- THE gateway ------------------------------------------------------------------------------------------------------
# checked QUIET MARKER_ERE LABEL CMD...: runs CMD, captures its output, prints it unless QUIET=quiet, and succeeds only
# when CMD exited 0 and the last non-empty line matches ^MARKER_ERE$.
checked() {
  local quiet=$1 marker=$2 label=$3; shift 3
  "$@" >"$tmp/$label.out" 2>&1; local rc=$?
  [[ $quiet == quiet ]] || cat "$tmp/$label.out"
  local last; last=$(grep -v '^[[:space:]]*$' "$tmp/$label.out" | tail -n 1)
  if [[ $rc -eq 0 && $last =~ ^($marker)$ ]]; then return 0; fi
  echo "OP.fail|$label|exit=$rc|the last line is not the success marker of $label"
  [[ $quiet == quiet ]] && { echo "OP.fail.output|$label:"; sed 's/^/  /' "$tmp/$label.out" | tail -n 20; }
  return 3
}
pod_probe() { # writes $tmp/pod.json and prints OP.pod… lines ending with OP.probe|ok
  kube_get pod "$LR_POD" >"$tmp/pod.json" || return 1
  python3 - "$tmp/pod.json" "$LR_POD" "$LR_NAMESPACE" <<'PY'
import json, sys
pod = json.load(open(sys.argv[1]))
meta = pod["metadata"]
if meta["name"] != sys.argv[2] or meta["namespace"] != sys.argv[3]:
    print("OP.pod.identity|mismatch|%s/%s" % (meta["namespace"], meta["name"])); sys.exit(1)
statuses = pod["status"]["containerStatuses"]
restarts = ",".join("%s=%d" % (c["name"], int(c["restartCount"])) for c in sorted(statuses, key=lambda c: c["name"]))
ready = ",".join("%s=%s" % (c["name"], "ready" if c["ready"] else "NOT-ready") for c in sorted(statuses, key=lambda c: c["name"]))
cond = [c["status"] for c in pod["status"].get("conditions", []) if c["type"] == "Ready"]
print("OP.pod|%s/%s|uid=%s" % (meta["namespace"], meta["name"], meta.get("uid", "-")))
print("OP.restarts|" + restarts)
print("OP.ready|containers|" + ready)
print("OP.ready|pod|" + (cond[0] if cond else "unknown"))
print("OP.probe|ok")
PY
}
db_probe() { # system identifier and Chronicle fence state, through the exec path
  printf '%s\n' '\set ON_ERROR_STOP on' "SET application_name = 'lr:op:probe';" "SET default_transaction_read_only = on;" \
    "SELECT 'OP.identity|' || system_identifier FROM pg_control_system();" \
    "SELECT 'OP.fence|' || CASE WHEN rolcanlogin THEN 'login' ELSE 'nologin' END || '|' || coalesce(shobj_description(oid, 'pg_authid'), '-') FROM pg_roles WHERE rolname = 'chronicle';" \
    '\echo OP.probe|ok' | $(psql_cmd postgres) -X -q -At -v ON_ERROR_STOP=1 -f -
}
value() { grep "^$2" "$tmp/$1.out" | tail -n 1 | cut -d'|' -f2-; }

before_probe() {
  checked quiet 'OP\.probe\|ok' pod-before pod_probe || { echo 'OP.before-probe|failed|nothing was sent'; exit 5; }
  checked quiet 'OP\.probe\|ok' db-before db_probe || { echo 'OP.before-probe|failed|nothing was sent'; exit 5; }
  local id; id=$(value db-before 'OP.identity|')
  if [[ $cmd != identify && $id != "$LR_SYSTEM_IDENTIFIER" ]]; then
    echo "OP.before-probe|identity mismatch: system identifier $id, confirmed $LR_SYSTEM_IDENTIFIER|nothing was sent"; exit 5
  fi
  local fence; fence=$(value db-before 'OP.fence|')
  if [[ $fence == nologin\|legacy-retirement\ fence\ since\ * ]]; then
    echo "FENCED since ${fence#nologin|legacy-retirement fence since } (role chronicle NOLOGIN); status: $self chronicle fence-status --role chronicle; lift: $self chronicle unfence --role chronicle"
  fi
  restarts_before=$(value pod-before 'OP.restarts|'); echo "LR.restarts|before|$restarts_before"
}
after_probe() { # $1 = exit status of the command
  local rc=$1
  checked quiet 'OP\.probe\|ok' pod-after pod_probe || { echo 'OP.after-probe|failed|the restart counts after the command are unknown'; exit 6; }
  local after; after=$(value pod-after 'OP.restarts|'); echo "LR.restarts|after|$after"
  if [[ $after != "$restarts_before" ]]; then
    echo "LR.restarts.changed|before:$restarts_before|after:$after"
    echo 'op: a container restarted during this command: check the service before continuing' >&2; exit 7
  fi
  exit "$rc"
}
success_marker() { # run.sh target mode -> the ERE of its own success line
  case $2 in
    preflight) echo 'LR\.result\|preflight-complete' ;;
    verify) echo 'LR\.result\|verify-zero(-formats-skipped)?' ;;
    dry-run) echo 'LR\.result\|dry-run-rolled-back' ;;
    apply) echo 'LR\.result\|applied(-formats-skipped)?' ;;
    sessions) echo 'LR\.result\|sessions-listed' ;;
    terminate) echo 'LR\.result\|terminate-complete' ;;
    worklist) echo 'LR\.result\|worklist-complete' ;;
    fence) echo 'LR\.result\|fenced' ;;
    unfence) echo 'LR\.result\|unfenced' ;;
    fence-status) echo 'LR\.result\|fence-status-complete' ;;
    *) return 1 ;;
  esac
}
configured_databases() { # strict: every PostgreSQL URL in each ConfigMap must parse; at least one per service
  local svc names=()
  for svc in chronicle haystack manure; do
    kube_get configmap "$svc" >"$tmp/cm-$svc.json" || { echo "op: cannot read ConfigMap $svc" >&2; return 1; }
    local db; db=$(python3 - "$tmp/cm-$svc.json" <<'PY'
import json, re, sys
cfg = json.loads(json.load(open(sys.argv[1]))["data"]["server.json"])
strict = re.compile(r"jdbc:postgresql://[A-Za-z0-9.-]+(:[0-9]{1,5})?/([a-z_][a-z0-9_]{0,62})")
found, bad = set(), []
def walk(x):
    if isinstance(x, dict):
        for v in x.values(): walk(v)
    elif isinstance(x, list):
        for v in x: walk(v)
    elif isinstance(x, str) and (x.lower().startswith("jdbc:") or re.search(r"(?i)postgres(ql)?://", x)):
        m = strict.fullmatch(x)
        if m: found.add(m.group(2))
        else: bad.append(x)
walk(cfg)
if bad or not found: sys.exit(1)
print(",".join(sorted(found)))
PY
) || { echo "op: ConfigMap $svc holds no JDBC URL or one this wrapper cannot parse (refusing)" >&2; return 1; }
    names+=("$db")
  done
  (IFS=,; echo "OP.configured|${names[*]}")
}

case $cmd in
  identify)
    before_probe
    echo "OP.confirm|pod=$LR_NAMESPACE/$LR_POD|system_identifier=$(value db-before 'OP.identity|')"
    echo 'OP.confirm|set LR_SYSTEM_IDENTIFIER to this value once the pod and cluster are confirmed'
    after_probe 0 ;;
  ready)
    before_probe; grep '^OP.ready|' "$tmp/pod-before.out"; after_probe 0 ;;
  restarts)
    before_probe; after_probe 0 ;;
  chronicle|haystack|manure)
    [[ $# -ge 1 ]] || fail "usage: op.sh $cmd <run.sh mode> [options]"
    marker=$(success_marker "$cmd" "$1") || fail "mode $1 is not available through op.sh"
    before_probe
    if [[ $cmd:$1 == chronicle:fence ]]; then
      # S5: say locally, before the fence is sent, what will persist and how to see and lift it.
      echo "OP.fence.warning|after this command role chronicle stays NOLOGIN until unfenced: Chronicle cannot connect,"
      echo "OP.fence.warning|its container restarts with back-off (up to 5 min), the core pod is not Ready (Haystack/Manure Service endpoints may drop)"
      echo "OP.fence.status|$self chronicle fence-status --role chronicle"
      echo "OP.fence.lift|$self chronicle unfence --role chronicle"
    fi
    export PSQL; PSQL=$(psql_cmd "$cmd")
    checked show "$marker" "$cmd-$1" sh "$here/run.sh" "$cmd" "$@"; rc=$?
    if [[ $cmd:$1 == chronicle:fence && $rc -ne 0 ]]; then
      echo "OP.fence.unknown|the fence may or may not be in place; check: $self chronicle fence-status --role chronicle; lift: $self chronicle unfence --role chronicle"
    fi
    after_probe "$rc" ;;
  drop)
    before_probe
    checked quiet 'OP\.configured\|[a-z0-9_,]+' configmaps configured_databases || { echo 'op: the configured service databases could not be read (refusing)'; after_probe 3; }
    dbs=$(value configmaps 'OP.configured|')
    echo "LR.configured_databases|$dbs"
    export PSQL; PSQL=$(psql_cmd postgres)
    if [[ ${1:-plan} == drop ]]; then marker='DB\.result\|(dropped|already-gone\|oid=[0-9]+)'; else marker='DB\.result\|plan-complete-nothing-dropped'; fi
    checked show "$marker" drop sh "$here/drop-databases.sh" "$@" --configured-databases "$dbs"; after_probe $? ;;
  backup-haystack)
    [[ $# -eq 1 ]] && single "$1" '/[A-Za-z0-9._/-]{1,200}' || fail 'backup-haystack FILE (absolute path of a new local file)'
    file=$1; [[ ! -e $file && ! -e $file.partial ]] || fail "$file exists"
    command -v pg_restore >/dev/null || fail 'pg_restore is required locally (nix develop .#chronicle)'
    before_probe
    dump() {
      (umask 077; pg_dump_stream haystack >"$file.partial") || { echo 'op: pg_dump failed'; return 3; }
      pg_restore --list "$file.partial" >/dev/null && pg_restore --exit-on-error --file=/dev/null "$file.partial" || { echo 'op: the archive does not decode to the end (incomplete): not a backup'; return 3; }
      mv "$file.partial" "$file"
      echo "LR.backup.file|$file|$(stat -c %s "$file")|$(sha256sum "$file" | cut -d' ' -f1)"
      echo 'LR.result|backup-decoded-completely'
    }
    checked show 'LR\.result\|backup-decoded-completely' backup-haystack dump; after_probe $? ;;
  backup-chronicle)
    [[ $# -eq 1 ]] && single "$1" 'lr_backup_chronicle_[0-9]{12}' || fail 'backup-chronicle NAME, NAME = lr_backup_chronicle_<YYYYMMDDHHMM>'
    before_probe
    copy() {
      printf '%s\n' '\set ON_ERROR_STOP on' "SET application_name = 'lr:backup:chronicle';" "SET statement_timeout = 0;" \
        "CREATE DATABASE $1 TEMPLATE chronicle STRATEGY FILE_COPY;" \
        "SELECT 'LR.backup.copy|' || datname || '|' || oid || '|' || pg_database_size(oid) FROM pg_database WHERE datname = '$1';" \
        '\echo LR.result|backup-created' | $(psql_cmd postgres) -X -q -At -v ON_ERROR_STOP=1 -f -
    }
    checked show 'LR\.result\|backup-created' backup-chronicle copy "$1"; after_probe $? ;;
  codec-check)
    before_probe
    export PSQL; PSQL=$(psql_cmd haystack)
    checked show 'LR\.result\|stored-documents-strict-ok' codec-check env TMPDIR="$tmp" sh "$here/check-stored-documents.sh"; after_probe $? ;;
  check-legacy-free)
    [[ ${1:-} == chronicle || ${1:-} == haystack ]] || fail 'check-legacy-free <chronicle|haystack> [-v require_formats=f]'
    target=$1; shift
    file=$here/../../../$target/scripts/check-legacy-free.sql
    [[ -f $file ]] || fail "retained check $file is absent"
    for a in "$@"; do single "$a" '(-v|require_formats=[tf])' || fail 'only -v require_formats=t|f may be passed'; done
    before_probe
    retained() { $(psql_cmd "$target") -X -q -v ON_ERROR_STOP=1 "$@" -f - <"$file"; }
    checked show 'LF\.result\|legacy-free' "check-legacy-free-$target" retained "$@"; after_probe $? ;;
  *) fail "unknown command $cmd" ;;
esac
