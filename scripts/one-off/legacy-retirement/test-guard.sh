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
lr_guard_inputs() {
  local f
  for f in "$lr_guard_dir"/*.sh "$lr_guard_dir"/rehearsal/*.sh; do
    [[ -f $f ]] || return 1
    # names referenced as $NAME / ${NAME…} / ${!NAME} (not escaped), minus names the same file assigns
    local code; code=$(grep -vE '^[[:space:]]*#' "$f")   # comments are not code
    comm -23 \
      <(grep -oE '(^|[^\\])\$\{?!?[A-Za-z_][A-Za-z0-9_]*' <<<"$code" | sed -E 's/^.?\$\{?!?//' | sort -u) \
      <({ grep -oE '(^|[;[:space:](])(export |local |readonly )?[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?\+?=' <<<"$code" | sed -E 's/^[;[:space:](]//; s/^(export |local |readonly )//; s/(\[[^]]*\])?\+?=$//'
          grep -oE '(^|[;[:space:]])for [A-Za-z_][A-Za-z0-9_]*' <<<"$code" | sed -E 's/^.*for //'
          grep -oE 'read( -[a-z]+)*( [A-Za-z_][A-Za-z0-9_]*)+' <<<"$code" | sed -E 's/^read( -[a-z]+)* //' | tr ' ' '\n'
          grep -oE '(local|declare)( -[a-z]+)?( [A-Za-z_][A-Za-z0-9_]*)+' <<<"$code" | sed -E 's/^(local|declare)( -[a-z]+)? //' | tr ' ' '\n'
        } | sort -u)
  done | grep -vE '^(BASH_SOURCE|BASH_REMATCH|LINENO|FUNCNAME|PIPESTATUS|RANDOM|SECONDS|IFS|OPTIND|OPTARG|REPLY|PWD|LR_GUARD_[A-Z_]*|lr_guard_[a-z_]*)$' | sort -u
}
lr_guard_refused() { # 0 when the named variable must not be inherited
  case " $LR_GUARD_EXEMPT " in *" $1 "*) return 1 ;; esac
  return 0
}
lr_guard_check() {
  local name inputs f
  if [[ -z $lr_guard_dir || ${#lr_guard_dir} -lt 2 || $lr_guard_dir == *$'\n'* ]]; then
    echo 'test refused: the guard cannot locate the scripts it protects' >&2; return 4; fi
  for f in $LR_GUARD_FILES; do [[ -f $lr_guard_dir/$f ]] || { echo "test refused: guard discovery found no $f in $lr_guard_dir" >&2; return 4; }; done
  inputs=$(set -o pipefail; lr_guard_inputs) || { echo 'test refused: the guard could not extract the script inputs' >&2; return 4; }
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
