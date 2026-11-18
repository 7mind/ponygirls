# Test isolation of the legacy-retirement scripts: the ONE place every fixture test sources first (bash).
# A test must never inherit a connection, a deployment target or any other input the scripts read from the
# environment. The refused set is DERIVED from the scripts, not enumerated by hand:
#   1. every variable a script reads but never assigns (an input from the environment), found by grepping the
#      scripts in this directory and rehearsal/ (`lr_guard_inputs`);
#   2. every variable with a prefix the tools read implicitly: PG* (libpq: psql, pg_dump, pg_restore), KUBE* and
#      KUBECTL_* (kubectl), LR_* (op.sh settings), CLONE_* (clone.sh), and PSQL;
# minus a short, explicit list of local tooling locations (LR_GUARD_EXEMPT) that select tools, not targets.
# test-scripts.sh asserts that every derived input is refused when set and that the exempt list holds no target.
LR_GUARD_EXEMPT='POSTGRES_HOME PG_BIN SBT_LAUNCH_JAR TMPDIR PATH HOME'   # PG_BIN: set by the dev shell (a tool directory)
# Discovery must not depend on the caller's shell: CDPATH (cd prints a path), GLOBIGNORE, noglob and nullglob are
# neutralised here, and every failure of discovery or extraction refuses (fail closed).
unset CDPATH GLOBIGNORE; set +f; shopt -u nullglob failglob 2>/dev/null
lr_guard_dir=$(builtin cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && builtin pwd -P) || lr_guard_dir=''
# Files whose inputs must be covered, and names that a correct extraction must find (each is read by a script).
LR_GUARD_FILES='run.sh drop-databases.sh op.sh check-stored-documents.sh test.sh test-drop-databases.sh test-scripts.sh rehearsal/clone.sh'
LR_GUARD_SENTINELS='PSQL POSTGRES_HOME LR_CONTEXT LR_SYSTEM_IDENTIFIER SOURCE_PG_DUMP CLONE_PORT'
lr_guard_match() { # grep that fails on a read or pattern error (exit > 1), not on "no line matched" (exit 1)
  local rc=0; grep "$@" || rc=$?; [[ $rc -le 1 ]]
}
# Runs in a subshell with pipefail: every stage of every file is checked; any failure fails the whole extraction.
lr_guard_inputs() (
  set -o pipefail
  f='' code='' refs='' assigned='' name='' rc=0
  for f in "$lr_guard_dir"/*.sh "$lr_guard_dir"/rehearsal/*.sh; do
    [[ -f $f && -r $f ]] || exit 1
    # names referenced as $NAME / ${NAME…} / ${!NAME} (not escaped), minus names the same file assigns
    code=$(lr_guard_match -vE '^[[:space:]]*#' "$f") || exit 1   # comments are not code
    refs=$(lr_guard_match -oE '(^|[^\\])\$\{?!?[A-Za-z_][A-Za-z0-9_]*' <<<"$code" | sed -E 's/^.?\$\{?!?//' | sort -u) || exit 1
    [[ -n $refs ]] || exit 1   # every script reads some variable: an empty result is a failed extraction
    assigned=$(lr_guard_match -oE '(^|[;[:space:](])(export |local |readonly )?[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?\+?=' <<<"$code" | sed -E 's/^[;[:space:](]//; s/^(export |local |readonly )//; s/(\[[^]]*\])?\+?=$//') || exit 1
    assigned+=$'\n'$(lr_guard_match -oE '(^|[;[:space:]])for [A-Za-z_][A-Za-z0-9_]*' <<<"$code" | sed -E 's/^.*for //') || exit 1
    assigned+=$'\n'$(lr_guard_match -oE 'read( -[a-z]+)*( [A-Za-z_][A-Za-z0-9_]*)+' <<<"$code" | sed -E 's/^read( -[a-z]+)* //' | tr ' ' '\n') || exit 1
    assigned+=$'\n'$(lr_guard_match -oE '(local|declare)( -[a-z]+)?( [A-Za-z_][A-Za-z0-9_]*)+' <<<"$code" | sed -E 's/^(local|declare)( -[a-z]+)? //' | tr ' ' '\n') || exit 1
    while IFS= read -r name; do
      [[ -n $name ]] || continue
      rc=0; grep -qxF -- "$name" <<<"$assigned" || rc=$?
      case $rc in 0) ;; 1) printf '%s\n' "$name" ;; *) exit 1 ;; esac
    done <<<"$refs"
  done | lr_guard_match -vE '^(BASH_SOURCE|BASH_REMATCH|LINENO|FUNCNAME|PIPESTATUS|RANDOM|SECONDS|IFS|OPTIND|OPTARG|REPLY|PWD|LR_GUARD_[A-Z_]*|lr_guard_[a-z_]*)$' | sort -u
)
lr_guard_refused() { # 0 when the named variable must not be inherited
  case " $LR_GUARD_EXEMPT " in *" $1 "*) return 1 ;; esac
  return 0
}
lr_guard_check() {
  local name inputs f
  if [[ -z $lr_guard_dir || ${#lr_guard_dir} -lt 2 || $lr_guard_dir == *$'\n'* ]]; then
    echo 'test refused: the guard cannot locate the scripts it protects' >&2; return 4; fi
  for f in $LR_GUARD_FILES; do [[ -f $lr_guard_dir/$f ]] || { echo "test refused: guard discovery found no $f in $lr_guard_dir" >&2; return 4; }; done
  inputs=$(lr_guard_inputs) || { echo 'test refused: the guard could not extract the script inputs' >&2; return 4; }
  for name in $LR_GUARD_SENTINELS; do
    grep -qx -- "$name" <<<"$inputs" || { echo "test refused: input extraction is implausible (no $name)" >&2; return 4; }
  done
  for name in $inputs $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' | grep -E '^(PG|KUBE|LR_|CLONE_|PSQL$)'); do
    [[ $name == LR_GUARD_* ]] && continue
    lr_guard_refused "$name" || continue
    if [[ -n ${!name+set} ]]; then
      printf 'test refused: %s is set in the environment (an input of the legacy-retirement scripts); run the fixture tests from a clean shell\n' "$name" >&2
      return 4
    fi
  done
  return 0
}
lr_guard_check || exit 4
