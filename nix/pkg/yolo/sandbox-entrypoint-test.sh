#!/usr/bin/env bash
# Tests for sandbox-entrypoint.sh: the in-sandbox pre-start steps (sourced hook
# commands and the final exec) are traced to stderr with a timestamp, while the
# secret values loaded before them never appear in the trace.
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

stdout="$(
  YOLO_SECRETS_FILE="$WORKDIR/secrets.env" YOLO_SANDBOX_HOOKS_FILE="$WORKDIR/hooks.sh" \
    bash "$ENTRYPOINT" bash -c 'printf "%s %s\n" "$ENTRYPOINT_TEST_SECRET" "$HOOK_EXPORTED"' \
    2> "$WORKDIR/stderr"
)"
stderr="$(< "$WORKDIR/stderr")"
timestamped_line='^\++ [0-9]+[.,][0-9]+ '

check "command receives the secret and the hook's exported env" \
  test "$stdout" = "$SECRET_VALUE 1"
check "hook command is traced with a timestamp" \
  grep -Eq "${timestamped_line}true hook-marker\$" <<< "$stderr"
check "final exec is traced with a timestamp" \
  grep -Eq "${timestamped_line}exec bash -c " <<< "$stderr"
check "trace carries no YOLO_* orchestration variable names" \
  bash -c '! grep -Fq YOLO_ <<< "$1"' _ "$stderr"
check "secret value never reaches the trace" \
  bash -c '! grep -Fq "$1" <<< "$2"' _ "$SECRET_VALUE" "$stderr"

echo "$((TESTS_RUN - FAILURES)) of $TESTS_RUN entrypoint checks passed"
[[ $FAILURES -eq 0 ]]
