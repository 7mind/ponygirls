#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
SCRIPT="$SCRIPT_DIR/llm-sandbox.sh"

FAILURES=0
TESTS_RUN=0
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
FAKE_BIN="$WORKDIR/bin"
_bash_path="$(command -v bash)"
mkdir -p "$FAKE_BIN"

printf '%s\n' \
  "#!$_bash_path" \
  'printf "%s\n" "$@"' \
  > "$FAKE_BIN/bwrap"
chmod +x "$FAKE_BIN/bwrap"

assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "FAIL: $desc -- expected output to contain [$needle]"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $desc -- expected [$expected], got [$actual]"
    FAILURES=$((FAILURES + 1))
  fi
}

OUT="$(PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" -- true 2>&1)"
STATUS=$?

assert_eq "sandbox invocation succeeds" "0" "$STATUS"
assert_contains \
  "sandbox provides the NixOS runtime-directory alias" \
  "$OUT" \
  $'--dir\n/var\n--symlink\n/run\n/var/run'
assert_contains "sandbox clears inherited environment" "$OUT" "--clearenv"
assert_contains "sandbox preserves HOME" "$OUT" $'--setenv\nHOME\n'"$HOME"
assert_contains "sandbox preserves PATH" "$OUT" $'--setenv\nPATH\n'

EXCHANGE_USER="$(id -un)"
EXCHANGE_DIR="/tmp/exchange/$EXCHANGE_USER"
assert_contains \
  "sandbox bind-mounts only the per-user exchange directory" \
  "$OUT" \
  $'--dir\n/tmp/exchange\n--bind\n'"$EXCHANGE_DIR"$'
'"$EXCHANGE_DIR"
assert_contains \
  "sandbox publishes the exchange directory" \
  "$OUT" \
  $'--setenv\nSMIND_EXCHANGE_DIR\n'"$EXCHANGE_DIR"
assert_eq "exchange parent is sticky and world-accessible" "1777" "$(stat -c %a -- /tmp/exchange)"
assert_eq "per-user exchange directory is private" "700" "$(stat -c %a -- "$EXCHANGE_DIR")"

# Caller --env must not be able to point the variable at a directory that was
# not the one bound above. The authoritative assignment is last.
OUT_OVERRIDE="$(PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" --env SMIND_EXCHANGE_DIR=/evil -- true 2>&1)"
OVERRIDE_VALUE="$(printf '%s\n' "$OUT_OVERRIDE" | awk '
  $0 == "--setenv" { getline name; getline value; if (name == "SMIND_EXCHANGE_DIR") last = value }
  END { print last }
')"
assert_eq "caller cannot retarget SMIND_EXCHANGE_DIR" "$EXCHANGE_DIR" "$OVERRIDE_VALUE"

# Isolated parent: a copy of the script pointed at a temporary root, so these
# cases do not depend on the live /tmp/exchange.
run_isolated() {
  local root="$1"
  shift
  local copy="$WORKDIR/llm-sandbox-isolated.sh"
  sed "s|^EXCHANGE_ROOT=\"/tmp/exchange\"|EXCHANGE_ROOT=\"$root\"|" "$SCRIPT" > "$copy"
  PATH="$FAKE_BIN:$PATH" bash "$copy" "$@"
}

ISO_ROOT="$(mktemp -d "$WORKDIR/exchange.XXXXXX")"
ISO_OUT="$(run_isolated "$ISO_ROOT" -- true 2>&1)"
ISO_STATUS=$?
assert_eq "isolated exchange setup succeeds" "0" "$ISO_STATUS"
assert_eq "isolated parent mode" "1777" "$(stat -c %a -- "$ISO_ROOT")"
assert_eq "isolated user directory mode" "700" "$(stat -c %a -- "$ISO_ROOT/$EXCHANGE_USER")"
assert_contains \
  "isolated sandbox binds the temporary user directory" \
  "$ISO_OUT" \
  $'--bind\n'"$ISO_ROOT/$EXCHANGE_USER"$'
'"$ISO_ROOT/$EXCHANGE_USER"

LINK_TARGET="$(mktemp -d "$WORKDIR/link-target.XXXXXX")"
chmod 0755 "$LINK_TARGET"
LINK_ROOT="$WORKDIR/exchange-link"
ln -s "$LINK_TARGET" "$LINK_ROOT"
LINK_OUT="$(run_isolated "$LINK_ROOT" -- true 2>&1)" && LINK_STATUS=0 || LINK_STATUS=$?
assert_eq "symlink exchange parent is refused" "1" "$LINK_STATUS"
assert_contains "symlink refusal names the parent" "$LINK_OUT" "is a symlink"
assert_eq "symlink refusal does not chmod the target" "755" "$(stat -c %a -- "$LINK_TARGET")"

FILE_ROOT="$WORKDIR/exchange-file"
printf 'not a directory\n' > "$FILE_ROOT"
FILE_OUT="$(run_isolated "$FILE_ROOT" -- true 2>&1)" && FILE_STATUS=0 || FILE_STATUS=$?
assert_eq "non-directory exchange parent is refused" "1" "$FILE_STATUS"
assert_contains "non-directory refusal is explicit" "$FILE_OUT" "not a directory"
assert_eq "non-directory parent is left in place" "not a directory" "$(cat "$FILE_ROOT")"

USER_LINK_ROOT="$(mktemp -d "$WORKDIR/user-link-parent.XXXXXX")"
chmod 1777 "$USER_LINK_ROOT"
USER_LINK_TARGET="$(mktemp -d "$WORKDIR/user-link-target.XXXXXX")"
chmod 0755 "$USER_LINK_TARGET"
ln -s "$USER_LINK_TARGET" "$USER_LINK_ROOT/$EXCHANGE_USER"
USER_LINK_OUT="$(run_isolated "$USER_LINK_ROOT" -- true 2>&1)" && USER_LINK_STATUS=0 || USER_LINK_STATUS=$?
assert_eq "symlink user exchange directory is refused" "1" "$USER_LINK_STATUS"
assert_contains "user symlink refusal is explicit" "$USER_LINK_OUT" "not a real directory"
assert_eq "user symlink refusal does not chmod the target" "755" "$(stat -c %a -- "$USER_LINK_TARGET")"

OUT_RUNTIME="$(PATH="$FAKE_BIN:$PATH" TERMINFO_DIRS=/test/terminfo \
  TERM_PROGRAM=tmux XDG_SESSION_TYPE=tty NIX_LD=/test/ld NIXPKGS_CONFIG=/test/nixpkgs.nix \
  LOCALE_ARCHIVE=/test/locale NIX_CONFIG=host-only __NIXOS_SET_ENVIRONMENT_DONE=1 \
  bash "$SCRIPT" -- true 2>&1)"
assert_contains "terminal database is retained" "$OUT_RUNTIME" $'--setenv\nTERMINFO_DIRS\n/test/terminfo'
assert_contains "terminal program is retained" "$OUT_RUNTIME" $'--setenv\nTERM_PROGRAM\ntmux'
assert_contains "session type is retained" "$OUT_RUNTIME" $'--setenv\nXDG_SESSION_TYPE\ntty'
assert_contains "Nix loader is retained" "$OUT_RUNTIME" $'--setenv\nNIX_LD\n/test/ld'
assert_contains "nixpkgs configuration path is retained" "$OUT_RUNTIME" $'--setenv\nNIXPKGS_CONFIG\n/test/nixpkgs.nix'
assert_contains "locale archive is retained" "$OUT_RUNTIME" $'--setenv\nLOCALE_ARCHIVE\n/test/locale'
assert_contains \
  "NixOS environment initialization sentinel is retained" \
  "$OUT_RUNTIME" \
  $'--setenv\n__NIXOS_SET_ENVIRONMENT_DONE\n1'
if [[ "$OUT_RUNTIME" == *$'--setenv\nNIX_CONFIG\n'* ]]; then
  echo "FAIL: NIX_CONFIG was forwarded"
  FAILURES=$((FAILURES + 1))
fi

OUT_EXPLICIT="$(PATH="$FAKE_BIN:$PATH" GH_TOKEN=host-token bash "$SCRIPT" --env GH_TOKEN=explicit-token -- true 2>&1)"
assert_contains "explicit environment is added" "$OUT_EXPLICIT" $'--setenv\nGH_TOKEN\nexplicit-token'

# Bind precedence: bwrap applies mounts in argv order, so the caller's own
# ordering must survive verbatim — a later --ro/--rw/--bind must be able to
# override an earlier one regardless of which flavour each one used.
ORDER_DIR="$WORKDIR/order"
mkdir -p "$ORDER_DIR/a" "$ORDER_DIR/b" "$ORDER_DIR/c" "$ORDER_DIR/d"
ORDER_OUT="$(PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" \
  --rw "$ORDER_DIR/a" \
  --ro-bind "$ORDER_DIR/b,$ORDER_DIR/b" \
  --ro "$ORDER_DIR/c" \
  --bind "$ORDER_DIR/d,$ORDER_DIR/d" \
  --ro "$ORDER_DIR/a" \
  -- true 2>/dev/null)"
ORDER_SEEN="$(printf '%s\n' "$ORDER_OUT" | grep -F -- "$ORDER_DIR" | tr '\n' ' ')"
assert_eq \
  "bind flavours are emitted in the order they were given" \
  "$ORDER_DIR/a $ORDER_DIR/a $ORDER_DIR/b $ORDER_DIR/b $ORDER_DIR/c $ORDER_DIR/c $ORDER_DIR/d $ORDER_DIR/d $ORDER_DIR/a $ORDER_DIR/a " \
  "$ORDER_SEEN"

# Launch trace: nothing by default; --trace prints the timestamped exec line(s)
# to stderr without changing what bwrap receives.
stderr_of() { PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" "$@" 2>&1 >/dev/null; }
stdout_of() { PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" "$@" 2>/dev/null; }
# A trace with every timestamp replaced by T, so its shape can be compared.
trace_shape() { sed -E 's/^(\++) [0-9]+[.,][0-9]+ /\1 T /'; }

assert_eq "default launch prints nothing of its own" "" "$(stderr_of --env TRACE_PROBE=1 -- true arg)"
TRACE_ERR="$(stderr_of --trace --env TRACE_PROBE=1 -- true arg)"
assert_eq "--trace prints exactly the exec line" "1" "$(grep -c '' <<< "$TRACE_ERR")"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ ! "$TRACE_ERR" =~ ^\+\ [0-9]+[.,][0-9]+\ exec\ bwrap\ --unshare-all\ --share-net\ --die-with-parent\ --clearenv\ .*\ --setenv\ TRACE_PROBE\ 1\ --setenv\ SMIND_EXCHANGE_DIR\ [^\ ]+\ true\ arg$ ]]; then
  echo "FAIL: --trace line is the timestamped exec of bwrap -- got [$TRACE_ERR]"
  FAILURES=$((FAILURES + 1))
fi
assert_eq "--trace does not change what bwrap receives" \
  "$(stdout_of --env TRACE_PROBE=1 -- true arg)" "$(stdout_of --trace --env TRACE_PROBE=1 -- true arg)"
assert_contains "--help documents --trace" "$(bash "$SCRIPT" --help)" "--trace"

assert_eq "--cowboy-ride prints nothing of its own by default" "" "$(stderr_of --cowboy-ride -- true arg)"
assert_eq "--cowboy-ride --trace prints the exec line" \
  "+ T exec bwrap --dev-bind / / -- true arg" "$(stderr_of --cowboy-ride --trace -- true arg | trace_shape)"

# A network namespace of its own (LLM_SANDBOX_NET_HELPER): this bwrap stand-in
# reports a child pid on --info-fd and waits for the release on --block-fd.
NET_BIN="$WORKDIR/net-bin"
mkdir -p "$NET_BIN"
printf '%s\n' \
  "#!$_bash_path" \
  'printf "%s\n" "$@"' \
  'printf "{\n    \"child-pid\": %s\n}\n" "$$" >&3' \
  'IFS= read -r -n 1 _ <&4 || true' \
  > "$NET_BIN/bwrap"
chmod +x "$NET_BIN/bwrap"
net_stderr_of() {
  PATH="$NET_BIN:$PATH" LLM_SANDBOX_NET_HELPER="$(command -v true)" bash "$SCRIPT" "$@" 2>&1 >/dev/null
}
assert_eq "network-helper launch prints nothing of its own by default" "" "$(net_stderr_of -- true arg)"
NET_TRACE="$(net_stderr_of --trace -- true arg | trace_shape)"
assert_eq "network-helper --trace prints the two launch steps" "2" "$(grep -c '' <<< "$NET_TRACE")"
assert_eq "network-helper --trace starts with the signal reset" "+ T trap - INT QUIT" "$(head -n 1 <<< "$NET_TRACE")"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ ! "$(tail -n 1 <<< "$NET_TRACE")" =~ ^\+\ T\ exec\ bwrap\ --unshare-all\ .*\ --unshare-net\ --info-fd\ 3\ --block-fd\ 4\ true\ arg$ ]]; then
  echo "FAIL: network-helper --trace ends with the exec of bwrap -- got [$NET_TRACE]"
  FAILURES=$((FAILURES + 1))
fi

if [[ $FAILURES -ne 0 ]]; then
  echo "$FAILURES of $TESTS_RUN tests failed"
  echo "$OUT"
  exit 1
fi
echo "All $TESTS_RUN tests passed"
