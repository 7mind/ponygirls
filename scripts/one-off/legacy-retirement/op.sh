#!/usr/bin/env bash
# Operator wrapper for the production run of the legacy retirement (plan section 7).
#
# Settings (environment; required; single line, closed alphabets; values in the deployment repository):
#   LR_CONTEXT LR_NAMESPACE LR_POD LR_CONTAINER (PostgreSQL container) LR_SOCKET (socket directory in it)
#   LR_ROLE (maintenance role, peer authentication) LR_SYSTEM_IDENTIFIER (confirmed once with `op.sh identify`)
#
# Commands:
#   op.sh identify | ready | restarts
#   op.sh <chronicle|haystack|manure> <run.sh mode> [options]   run.sh against that target's own database
#   op.sh drop [plan | drop --drop NAME --confirm-database NAME --expect-oid OID | restore --oid OID --confirm-database NAME]
#   op.sh backup-haystack FILE | backup-manure FILE | backup-chronicle NAME | codec-check | check-legacy-free <chronicle|haystack> [-v require_formats=f]
#
# The LAST line of every invocation is ONE record of this wrapper:
#   OP.result|ok|<the command's own success line>                          exit 0
#   OP.result|ok-unmonitored|<success line>|pod not observable             exit 8 (emergency fence-status/unfence only)
#   OP.result|failed|<exit code>|<reason>                                   exit 2, 3, 5, 6 or 7
# Exit codes: 0 done and verified; 2 usage or settings (nothing sent); 3 the command did not end with its own success
# line (refused, failed, or a cut stream — re-check with preflight/plan); 5 before-probe failed or the system
# identifier differs (nothing sent); 6 the command's outcome is printed above but the pod could not be observed
# afterwards (check `ready`); 7 a container restarted or the pod was replaced during the command (check the service
# and the command's state); 8 emergency path succeeded without pod observation (see plan 7.2).
# Output is streamed while it is captured; run.sh prints its session's application_name locally before it starts.
set -uo pipefail
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
self=$here/op.sh
finish() { # code status detail
  if [[ $1 -eq 0 ]]; then echo "OP.result|ok|$3"
  elif [[ $1 -eq 8 ]]; then echo "OP.result|ok-unmonitored|$3|pod not observable"
  else echo "OP.result|failed|$1|$3"; fi
  exit "$1"
}
usage() { finish 2 failed "$1"; }
single() { [[ $1 != *$'\n'* && $1 != *$'\r'* && $1 =~ ^$2$ ]]; }
[[ $# -ge 1 ]] || usage 'usage: see the header of op.sh'
cmd=$1; shift
for v in LR_CONTEXT LR_NAMESPACE LR_POD LR_CONTAINER LR_ROLE; do
  single "${!v:-}" '[A-Za-z0-9][A-Za-z0-9._-]{0,252}' || usage "$v must be set (single line, [A-Za-z0-9._-])"
done
single "${LR_SOCKET:-}" '/[A-Za-z0-9._/-]{1,200}' || usage 'LR_SOCKET must be an absolute socket directory path'
if [[ $cmd != identify ]]; then
  single "${LR_SYSTEM_IDENTIFIER:-}" '[0-9]{1,20}' || usage 'LR_SYSTEM_IDENTIFIER must be set to the value confirmed once with: op.sh identify'
fi
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# --- the only places that name kubectl ------------------------------------------------------------------------------
kube_get() { kubectl "--context=$LR_CONTEXT" -n "$LR_NAMESPACE" --request-timeout=30s get "$@" -o json; }
psql_cmd() { printf 'kubectl --context=%s -n %s exec -i %s -c %s -- psql -h %s -U %s -d %s' "$LR_CONTEXT" "$LR_NAMESPACE" "$LR_POD" "$LR_CONTAINER" "$LR_SOCKET" "$LR_ROLE" "$1"; }
pg_dump_stream() { kubectl "--context=$LR_CONTEXT" -n "$LR_NAMESPACE" exec "$LR_POD" -c "$LR_CONTAINER" -- env "PGAPPNAME=lr:backup:$1" pg_dump -h "$LR_SOCKET" -U "$LR_ROLE" --lock-wait-timeout=10s --format=custom -d "$1"; }

# --- THE gateway: checked QUIET MARKER_ERE LABEL CMD… -----------------------------------------------------------------
# Runs CMD, streams its output (unless quiet) while capturing it; succeeds only when CMD exited 0 AND the last
# non-empty line matches ^MARKER_ERE$. The matched line is left in $tmp/LABEL.ok.
checked() {
  local quiet=$1 marker=$2 label=$3; shift 3
  if [[ $quiet == quiet ]]; then "$@" >"$tmp/$label.out" 2>&1; else "$@" 2>&1 | tee "$tmp/$label.out"; fi
  local rc=${PIPESTATUS[0]} last; last=$(grep -v '^[[:space:]]*$' "$tmp/$label.out" | tail -n 1)
  if [[ $rc -eq 0 && $last =~ ^($marker)$ ]]; then printf '%s' "$last" >"$tmp/$label.ok"; return 0; fi
  # quiet probes are reported by their caller (finish/warning); shown commands get the failure line here
  [[ $quiet == quiet ]] || echo "OP.fail|$label|exit=$rc|last line: ${last:0:160}"
  return 3
}
pod_probe() { # prints OP.pod|uid|start, OP.restarts, OP.ready lines, ending with OP.probe|ok
  kube_get pod "$LR_POD" >"$tmp/pod.json" || return 1
  python3 - "$tmp/pod.json" "$LR_POD" "$LR_NAMESPACE" <<'PY'
import json, sys
pod = json.load(open(sys.argv[1]))
meta, status = pod["metadata"], pod["status"]
if meta["name"] != sys.argv[2] or meta["namespace"] != sys.argv[3]:
    print("OP.pod.identity|mismatch|%s/%s" % (meta["namespace"], meta["name"])); sys.exit(1)
statuses = sorted(status["containerStatuses"], key=lambda c: c["name"])
print("OP.pod|%s/%s|uid=%s|start=%s" % (meta["namespace"], meta["name"], meta["uid"], status["startTime"]))
print("OP.restarts|" + ",".join("%s=%d" % (c["name"], int(c["restartCount"])) for c in statuses))
print("OP.ready|containers|" + ",".join("%s=%s" % (c["name"], "ready" if c["ready"] else "NOT-ready") for c in statuses))
cond = [c["status"] for c in status.get("conditions", []) if c["type"] == "Ready"]
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
pod_state() { printf '%s|%s' "$(value "$1" 'OP.pod|')" "$(value "$1" 'OP.restarts|')"; }

unmonitored=0
before_probe() { # $1 = allow-unmonitored for the emergency path (fence-status/unfence)
  if ! checked quiet 'OP\.probe\|ok' pod-before pod_probe; then
    [[ ${1:-} == allow-unmonitored ]] || finish 5 failed "before-probe: pod not observable ($(grep -v '^[[:space:]]*$' "$tmp/pod-before.out" | tail -n 1 | cut -c1-120)); nothing was sent"
    unmonitored=1
  fi
  checked quiet 'OP\.probe\|ok' db-before db_probe || finish 5 failed 'before-probe: database not reachable; nothing was sent'
  local id; id=$(value db-before 'OP.identity|')
  if [[ $cmd != identify && $id != "$LR_SYSTEM_IDENTIFIER" ]]; then
    finish 5 failed "system identifier $id differs from the confirmed $LR_SYSTEM_IDENTIFIER; nothing was sent"
  fi
  local fence; fence=$(value db-before 'OP.fence|')
  if [[ $fence == nologin\|legacy-retirement\ fence\ since\ * ]]; then
    echo "FENCED since ${fence#nologin|legacy-retirement fence since } (role chronicle NOLOGIN); status: $self chronicle fence-status --role chronicle; lift: $self chronicle unfence --role chronicle"
  fi
  [[ $unmonitored -eq 1 ]] && echo 'OP.warning|emergency path: the pod cannot be observed; the database identity is still checked'
  [[ $unmonitored -eq 1 ]] || { pod_before=$(pod_state pod-before); echo "LR.restarts|before|$(value pod-before 'OP.restarts|')"; }
}
after() { # $1 = exit status of the command (0 or 3), $2 = label of the checked command
  local rc=$1 line; line=$(cat "$tmp/$2.ok" 2>/dev/null)
  if [[ $unmonitored -eq 1 ]]; then [[ $rc -eq 0 ]] && finish 8 ok "$line"; finish 3 failed "$2 did not end with its success line (pod not observable)"; fi
  checked quiet 'OP\.probe\|ok' pod-after pod_probe || finish 6 failed "after-probe: pod not observable; the outcome of $2 is printed above"
  echo "LR.restarts|after|$(value pod-after 'OP.restarts|')"
  local now; now=$(pod_state pod-after)
  if [[ $now != "$pod_before" ]]; then
    echo "LR.pod.changed|before:$pod_before|after:$now"
    finish 7 failed "a container restarted or the pod was replaced during $2; check the service and the command's state"
  fi
  [[ $rc -eq 0 ]] && finish 0 ok "$line"
  finish 3 failed "$2 did not end with its success line"
}
success_marker() { # run.sh mode -> the ERE of its one success line
  case $1 in
    preflight) echo 'LR\.result\|preflight-complete' ;;
    verify) echo 'LR\.result\|verify-zero' ;;
    dry-run) echo 'LR\.result\|dry-run-rolled-back' ;;
    apply) echo 'LR\.result\|applied' ;;
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
    kube_get configmap "$svc" >"$tmp/cm-$svc.json" || { echo "op: cannot read ConfigMap $svc"; return 1; }
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
) || { echo "op: ConfigMap $svc holds no JDBC URL or one this wrapper cannot parse (refusing)"; return 1; }
    names+=("$db")
  done
  (IFS=,; echo "OP.configured|${names[*]}")
}

case $cmd in
  identify)
    before_probe
    echo "OP.confirm|pod=$LR_NAMESPACE/$LR_POD|system_identifier=$(value db-before 'OP.identity|')"
    echo 'OP.confirm|set LR_SYSTEM_IDENTIFIER to this value once the pod and cluster are confirmed'
    printf 'OP.confirm|identified' >"$tmp/identify.ok"; after 0 identify ;;
  ready)
    before_probe; grep '^OP.ready|' "$tmp/pod-before.out"; printf 'OP.ready|observed' >"$tmp/ready.ok"; after 0 ready ;;
  restarts)
    before_probe; printf 'OP.restarts|observed' >"$tmp/restarts.ok"; after 0 restarts ;;
  chronicle|haystack|manure)
    [[ $# -ge 1 ]] || usage "usage: op.sh $cmd <run.sh mode> [options]"
    marker=$(success_marker "$1") || usage "mode $1 is not available through op.sh"
    emergency=''; [[ $cmd:$1 == chronicle:fence-status || $cmd:$1 == chronicle:unfence ]] && emergency=allow-unmonitored
    before_probe $emergency
    if [[ $cmd:$1 == chronicle:fence ]]; then
      # before the fence is sent: what will persist and how to see and lift it
      echo "OP.fence.warning|after this command role chronicle stays NOLOGIN until unfenced: Chronicle cannot connect,"
      echo "OP.fence.warning|its container restarts with back-off (up to 5 min), the core pod is not Ready (Haystack/Manure Service endpoints may drop)"
      echo "OP.fence.status|$self chronicle fence-status --role chronicle"
      echo "OP.fence.lift|$self chronicle unfence --role chronicle"
    fi
    export PSQL; PSQL=$(psql_cmd "$cmd")
    checked show "$marker" "$cmd-$1" sh "$here/run.sh" "$cmd" "$@"; rc=$?
    [[ $cmd:$1 == chronicle:fence && $rc -ne 0 ]] && echo "OP.fence.unknown|check: $self chronicle fence-status --role chronicle; lift: $self chronicle unfence --role chronicle"
    after "$rc" "$cmd-$1" ;;
  drop)
    before_probe
    checked quiet 'OP\.configured\|[a-z0-9_,]+' configmaps configured_databases || { cat "$tmp/configmaps.out"; after 3 configmaps; }
    dbs=$(value configmaps 'OP.configured|'); echo "LR.configured_databases|$dbs"
    export PSQL; PSQL=$(psql_cmd postgres)
    case ${1:-plan} in
      drop) marker='DB\.result\|(dropped|already-gone)\|oid=[0-9]+' ;;
      restore) marker='DB\.result\|restored\|oid=[0-9]+' ;;
      *) marker='DB\.result\|plan-complete-nothing-dropped' ;;
    esac
    checked show "$marker" drop sh "$here/drop-databases.sh" "$@" --configured-databases "$dbs"; after $? drop ;;
  backup-haystack|backup-manure) # one implementation; the target is the command's own database (no Chronicle dump: Q102)
    target=${cmd#backup-}
    [[ $# -eq 1 ]] && single "$1" '/[A-Za-z0-9._/-]{1,200}' || usage "$cmd FILE (absolute path of a new local file)"
    file=$1; [[ ! -e $file && ! -e $file.partial ]] || usage "$file exists"
    command -v pg_restore >/dev/null || usage 'pg_restore is required locally (nix develop .#chronicle)'
    before_probe
    publish() { # every step checked; the success line only after the final file re-reads as recorded
      (umask 077; pg_dump_stream "$target" >"$file.partial") || { echo 'op: pg_dump failed'; return 3; }
      pg_restore --list "$file.partial" >/dev/null && pg_restore --exit-on-error --file=/dev/null "$file.partial" || { echo 'op: the archive does not decode to the end (incomplete): not a backup'; return 3; }
      local size sum; size=$(stat -c %s "$file.partial") && sum=$(sha256sum "$file.partial" | cut -d' ' -f1) || { echo 'op: cannot measure the archive'; return 3; }
      [[ $size =~ ^[1-9][0-9]*$ && $sum =~ ^[0-9a-f]{64}$ ]] || { echo 'op: implausible size or checksum'; return 3; }
      mv -n -- "$file.partial" "$file" || { echo 'op: cannot publish the archive under its final name'; return 3; }
      [[ ! -e $file.partial && -f $file ]] || { echo 'op: the final file is not in place'; return 3; }
      [[ $(stat -c %s "$file") == "$size" && $(sha256sum "$file" | cut -d' ' -f1) == "$sum" ]] || { echo 'op: the final file differs from the decoded archive'; return 3; }
      echo "LR.backup.file|$file|$size|$sum"
      echo 'LR.result|backup-published'
    }
    checked show 'LR\.result\|backup-published' "$cmd" publish; after $? "$cmd" ;;
  backup-chronicle)
    [[ $# -eq 1 ]] && single "$1" 'lr_backup_chronicle_[0-9]{12}' || usage 'backup-chronicle NAME, NAME = lr_backup_chronicle_<YYYYMMDDHHMM>'
    before_probe
    copy() {
      printf '%s\n' '\set ON_ERROR_STOP on' "SET application_name = 'lr:backup:chronicle';" "SET statement_timeout = 0;" \
        "CREATE DATABASE $1 TEMPLATE chronicle STRATEGY FILE_COPY;" \
        "SELECT 'LR.backup.copy|' || datname || '|' || oid || '|' || pg_database_size(oid) FROM pg_database WHERE datname = '$1';" \
        '\echo LR.result|backup-created' | $(psql_cmd postgres) -X -q -At -v ON_ERROR_STOP=1 -f -
    }
    checked show 'LR\.result\|backup-created' backup-chronicle copy "$1"; after $? backup-chronicle ;;
  codec-check)
    before_probe
    export PSQL; PSQL=$(psql_cmd haystack)
    checked show 'LR\.result\|stored-documents-strict-ok' codec-check env TMPDIR="$tmp" sh "$here/check-stored-documents.sh"; after $? codec-check ;;
  check-legacy-free)
    [[ ${1:-} == chronicle || ${1:-} == haystack ]] || usage 'check-legacy-free <chronicle|haystack> [-v require_formats=f]'
    target=$1; shift
    file=$here/../../../$target/scripts/check-legacy-free.sql
    [[ -f $file ]] || usage "retained check $file is absent"
    for a in "$@"; do single "$a" '(-v|require_formats=[tf])' || usage 'only -v require_formats=t|f may be passed'; done
    before_probe
    retained() { $(psql_cmd "$target") -X -q -v ON_ERROR_STOP=1 "$@" -f - <"$file"; }
    checked show 'LF\.result\|legacy-free' "check-legacy-free-$target" retained "$@"; after $? "check-legacy-free-$target" ;;
  *) usage "unknown command $cmd" ;;
esac
