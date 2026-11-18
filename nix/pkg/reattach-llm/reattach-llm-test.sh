#!/usr/bin/env bash
# Help, usage-error and environment-failure paths of reattach-llm. None of them
# needs tmux, sudo or a process table: tmux, ps and id are replaced by stubs
# that record any call, and the suite asserts that none was made.
# Usage: bash nix/pkg/reattach-llm/reattach-llm-test.sh
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
SCRIPT="$SCRIPT_DIR/reattach-llm.sh"
readonly SUDO_WRAPPER="/run/wrappers/bin/sudo"

FAILURES=0
TESTS_RUN=0
SKIPPED=0
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
STUBS="$WORKDIR/stubs"
CALLS="$WORKDIR/calls"
_bash_path="$(command -v bash)"
mkdir -p "$STUBS"
for _tool in tmux ps id; do
  printf '%s\n' "#!$_bash_path" "printf '%s\n' \"$_tool \$*\" >> '$CALLS'" 'exit 97' > "$STUBS/$_tool"
  chmod +x "$STUBS/$_tool"
done

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $desc -- expected [$expected], got [$actual]"
    FAILURES=$((FAILURES + 1))
  fi
}

# run TMUX_VALUE ARGS...: an empty TMUX_VALUE runs outside tmux. Sets OUT, ERR, STATUS.
run() {
  local _tmux="$1"; shift
  if [[ -n "$_tmux" ]]; then
    OUT="$(TMUX="$_tmux" PATH="$STUBS:$PATH" bash "$SCRIPT" "$@" 2>"$WORKDIR/stderr")"
  else
    OUT="$(env -u TMUX PATH="$STUBS:$PATH" bash "$SCRIPT" "$@" 2>"$WORKDIR/stderr")"
  fi
  STATUS=$?
  ERR="$(cat "$WORKDIR/stderr")"
}

HELP="reattach-llm — move a detached Claude or Codex terminal into the current tmux pane

Usage: reattach-llm
       reattach-llm --attach PID TARGET_PANE   (used by the menu)

Run inside tmux. Shows a menu of Claude/Codex processes that are not attached
to any tmux pane; choosing one re-parents its terminal into this pane.
Needs the setuid sudo wrapper at $SUDO_WRAPPER (NixOS) for reptyr."

assert_help() {
  local desc="$1"; shift
  run "" "$@"
  assert_eq "$desc exits 0" "0" "$STATUS"
  assert_eq "$desc prints the help to stdout" "$HELP" "$OUT"
  assert_eq "$desc prints nothing to stderr" "" "$ERR"
}

assert_usage_error() {
  local desc="$1" message="$2"; shift 2
  run "" "$@"
  assert_eq "$desc exits 2" "2" "$STATUS"
  assert_eq "$desc prints nothing to stdout" "" "$OUT"
  assert_eq "$desc names the problem and points at the help" \
    "reattach-llm: $message"$'\n'"Try 'reattach-llm --help'." "$ERR"
}

# Help precedes every environment check: no tmux, and id/ps/tmux would fail.
assert_help "--help" --help
assert_help "-h" -h
assert_help "--help after --attach" --attach 4242 --help
assert_help "-h after an unknown argument" bogus -h

# Usage errors precede the environment checks too.
assert_usage_error "an unknown argument" "unknown argument 'bogus'" bogus
assert_usage_error "an unknown flag" "unknown argument '--list'" --list
assert_usage_error "an empty argument" "unknown argument ''" ""
assert_usage_error "--attach after another argument" "unknown argument 'now'" now --attach 4242 %1
assert_usage_error "--attach alone" "--attach needs exactly PID and TARGET_PANE" --attach
assert_usage_error "--attach without a pane" "--attach needs exactly PID and TARGET_PANE" --attach 4242
assert_usage_error "--attach with a third value" "--attach needs exactly PID and TARGET_PANE" --attach 4242 %1 %2
assert_usage_error "--attach with a non-numeric PID" "--attach PID must be a number, got 'claude'" --attach claude %1
assert_usage_error "--attach with an empty pane" "--attach TARGET_PANE must not be empty" --attach 4242 ""

# Environment failures keep exit 1 and say what to do.
run ""
assert_eq "outside tmux exits 1" "1" "$STATUS"
assert_eq "outside tmux prints nothing to stdout" "" "$OUT"
assert_eq "outside tmux says where to run it" "reattach-llm: run it inside tmux." "$ERR"
run "" --attach 4242 %1
assert_eq "--attach outside tmux exits 1" "1" "$STATUS"
assert_eq "--attach outside tmux says where to run it" "reattach-llm: run it inside tmux." "$ERR"

# With the wrapper present the next step would drive the real tmux server, so
# the missing-wrapper message is only observable on a host without it.
if [[ -u "$SUDO_WRAPPER" ]]; then
  echo "SKIP: missing-sudo-wrapper message ($SUDO_WRAPPER exists on this host)"
  SKIPPED=$((SKIPPED + 1))
else
  run "/tmp/stub-tmux-socket,1,0"
  assert_eq "missing sudo wrapper exits 1" "1" "$STATUS"
  assert_eq "missing sudo wrapper prints nothing to stdout" "" "$OUT"
  assert_eq "missing sudo wrapper is named" \
    "reattach-llm: needs the setuid sudo wrapper at $SUDO_WRAPPER (NixOS); it is missing here." "$ERR"
fi

TESTS_RUN=$((TESTS_RUN + 1))
if [[ -e "$CALLS" ]]; then
  echo "FAIL: help, usage and environment paths ran external tools: $(tr '\n' ';' < "$CALLS")"
  FAILURES=$((FAILURES + 1))
fi

echo "reattach-llm-test: $TESTS_RUN tests, $FAILURES failures, $SKIPPED skipped"
[[ $FAILURES -eq 0 ]] || exit 1
