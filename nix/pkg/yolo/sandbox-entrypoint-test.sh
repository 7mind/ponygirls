#!/usr/bin/env bash
# Tests for sandbox-entrypoint.sh: by default it prints nothing of its own; with
# YOLO_SANDBOX_TRACE=1 the in-sandbox pre-start steps (sourced hook commands and
# the final exec) are traced to stderr with a timestamp, while the secret values
# loaded before them never appear in the trace. Either way the command's
# environment carries none of the entrypoint's own variables.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ENTRYPOINT="$SCRIPT_DIR/sandbox-entrypoint.sh"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

SECRET_VALUE="entrypoint-secret-value"
printf 'ENTRYPOINT_TEST_SECRET=%s\n' "$SECRET_VALUE" > "$WORKDIR/secrets.env"
printf '%s\n' 'true hook-marker' 'export HOOK_EXPORTED=1' > "$WORKDIR/hooks.sh"

TESTS_RUN=0
FAILURES=0
check() {
  local description="$1"
  shift
  TESTS_RUN=$((TESTS_RUN + 1))
  if "$@"; then
    echo "ok: $description"
  else
    echo "FAIL: $description" >&2
    FAILURES=$((FAILURES + 1))
  fi
}

# The command reports what it received and which entrypoint variables are still
# in its environment ("unset" for each one that is gone). It is a file so that
# the traced exec line names no variable itself.
TOOL="$WORKDIR/tool.sh"
printf '%s\n' 'printf "%s %s %s %s %s\n" "$ENTRYPOINT_TEST_SECRET" "$HOOK_EXPORTED" "${YOLO_SANDBOX_TRACE-unset}" "${YOLO_SECRETS_FILE-unset}" "${YOLO_SANDBOX_HOOKS_FILE-unset}"' > "$TOOL"
EXPECTED_STDOUT="$SECRET_VALUE 1 unset unset unset"

# run_entrypoint STDERR_FILE [NAME=VALUE...]: runs the tool behind the entrypoint
# with the secrets and hooks files plus the given extra environment.
run_entrypoint() {
  local stderr_file="$1"
  shift
  env -u YOLO_SANDBOX_TRACE "$@" \
    YOLO_SECRETS_FILE="$WORKDIR/secrets.env" YOLO_SANDBOX_HOOKS_FILE="$WORKDIR/hooks.sh" \
    bash "$ENTRYPOINT" bash "$TOOL" 2> "$stderr_file"
}
timestamped_line='^\++ [0-9]+[.,][0-9]+ '
# The trace with every timestamp replaced by T, so its shape can be compared.
trace_shape() { sed -E 's/^(\++) [0-9]+[.,][0-9]+ /\1 T /' "$1"; }

# Default: no trace.
stdout="$(run_entrypoint "$WORKDIR/stderr.default")"
check "command receives the secret and the hook's exported env" \
  test "$stdout" = "$EXPECTED_STDOUT"
default_stderr="$(< "$WORKDIR/stderr.default")"
check "default run prints nothing of its own" \
  test "$default_stderr" = ""
stdout="$(run_entrypoint "$WORKDIR/stderr.zero" YOLO_SANDBOX_TRACE=0)"
zero_stderr="$(< "$WORKDIR/stderr.zero")"
check "YOLO_SANDBOX_TRACE=0 prints nothing either" \
  test "$stdout|$zero_stderr" = "$EXPECTED_STDOUT|"

# YOLO_SANDBOX_TRACE=1: the hook steps and the final exec, and nothing before them.
stdout="$(run_entrypoint "$WORKDIR/stderr.traced" YOLO_SANDBOX_TRACE=1)"
stderr="$(< "$WORKDIR/stderr.traced")"
check "traced command receives the same and none of the entrypoint's variables" \
  test "$stdout" = "$EXPECTED_STDOUT"
check "hook command is traced with a timestamp" \
  grep -Eq "${timestamped_line}true hook-marker\$" <<< "$stderr"
check "final exec is traced with a timestamp" \
  grep -Eq "${timestamped_line}exec bash $TOOL\$" <<< "$stderr"
check "trace is the hook steps followed by the final exec, nothing else" \
  test "$(trace_shape "$WORKDIR/stderr.traced")" = \
"+ T '[' -n $WORKDIR/hooks.sh ']'
+ T . $WORKDIR/hooks.sh
++ T true hook-marker
++ T export HOOK_EXPORTED=1
++ T HOOK_EXPORTED=1
+ T exec bash $TOOL"
check "trace carries no YOLO_* orchestration variable names" \
  bash -c '! grep -Fq YOLO_ <<< "$1"' _ "$stderr"
check "secret value never reaches the trace" \
  bash -c '! grep -Fq "$1" <<< "$2"' _ "$SECRET_VALUE" "$stderr"

echo "$((TESTS_RUN - FAILURES)) of $TESTS_RUN entrypoint checks passed"
[[ $FAILURES -eq 0 ]]
