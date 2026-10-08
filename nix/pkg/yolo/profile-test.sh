#!/usr/bin/env bash
# Regression tests exercise the public yolo CLI with a recording sandbox.
set -u
YOLO_SQLITE="$(command -v sqlite3)" || { echo "profile-test.sh: sqlite3 must be on PATH" >&2; exit 1; }
export YOLO_SQLITE
export YOLO_PI_SHARED_ASSETS=$'settings.json\nAGENTS.md\nAPPEND_SYSTEM.md\nintegration-agents\nprompts\nskills\nextensions\nmcp.json'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
SCRIPT="$SCRIPT_DIR/yolo.sh"

FAILURES=0
TESTS_RUN=0
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
PROJECT_DIR="$WORKDIR/project"
FAKE_HOME="$WORKDIR/home"
FAKE_BIN="$WORKDIR/bin"
_bash_path="$(command -v bash)"
mkdir -p \
  "$PROJECT_DIR" \
  "$FAKE_BIN" \
  "$FAKE_HOME/.agents" \
  "$FAKE_HOME/.claude" \
  "$FAKE_HOME/.codex/prompts" \
  "$FAKE_HOME/.codex/skills" \
  "$FAKE_HOME/.config/claude" \
  "$FAKE_HOME/.config/codex" \
  "$FAKE_HOME/.pi/agent/integration-agents" \
  "$FAKE_HOME/.pi/agent/prompts"
printf 'x\n' > "$FAKE_HOME/.codex/AGENTS.md"
printf 'x\n' > "$FAKE_HOME/.codex/config.toml"
printf 'x\n' > "$FAKE_HOME/.codex/prompts/cq:plan.md"
printf 'x\n' > "$FAKE_HOME/.pi/agent/APPEND_SYSTEM.md"
printf 'x\n' > "$FAKE_HOME/.pi/agent/integration-agents/reviewer.md"
printf 'x\n' > "$FAKE_HOME/.pi/agent/prompts/cq:plan.md"

printf '%s\n' \
  "#!$_bash_path" \
  'printf "%s\n" "$@"' \
  'previous=' \
  'for arg in "$@"; do' \
  '  if [[ "$previous" == "--ro-bind" && "$arg" == *,/run/yolo-sandbox-prestart.sh ]]; then cat "${arg%%,*}"; fi' \
  '  previous="$arg"' \
  'done' \
  > "$FAKE_BIN/record-sandbox"
chmod +x "$FAKE_BIN/record-sandbox"

assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "FAIL: $desc -- expected output to contain [$needle]"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_not_contains() {
  local desc="$1" haystack="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "FAIL: $desc -- expected output NOT to contain [$needle]"
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

run_profile_yolo() {
  local config_home="$1"; shift
  {
    cd "$PROJECT_DIR" &&
      HOME="$FAKE_HOME" \
      XDG_CONFIG_HOME="$config_home" \
      YOLO_LLM_SANDBOX="$FAKE_BIN/record-sandbox" \
      YOLO_SANDBOX_ENTRYPOINT="$(command -v true)" \
      YOLO_NIX_LD="$(command -v true)" \
      YOLO_JQ="$(command -v jq)" \
      YOLO_TASKSET="$(command -v taskset)" \
      YOLO_CUSTOM_PROMPT="$SCRIPT_DIR/custom-prompt.sh" \
      bash "$SCRIPT" "$@" --profile foo cmd true
  } 2>&1
}

GLOBAL_CONFIG_HOME="$WORKDIR/xdg-config"
mkdir -p "$GLOBAL_CONFIG_HOME"
OUT="$(run_profile_yolo "$GLOBAL_CONFIG_HOME")"
STATUS=$?

assert_eq "named profile launch succeeds" "0" "$STATUS"
assert_contains \
  "named profile shares the agents registry read-only" \
  "$OUT" \
  $'--ro\n'"$FAKE_HOME/.agents"
assert_contains \
  "named profile re-shares Codex prompts read-only" \
  "$OUT" \
  "$FAKE_HOME/.codex/prompts,$FAKE_HOME/.codex/prompts"
assert_contains \
  "named profile re-shares Pi prompts read-only" \
  "$OUT" \
  "$FAKE_HOME/.pi/agent/prompts,$FAKE_HOME/.pi/agent/prompts"
assert_contains \
  "named profile re-shares integration-provided Pi assets read-only" \
  "$OUT" \
  "$FAKE_HOME/.pi/agent/integration-agents,$FAKE_HOME/.pi/agent/integration-agents"
assert_contains \
  "named profile re-shares Pi appended system prompt read-only" \
  "$OUT" \
  "$FAKE_HOME/.pi/agent/APPEND_SYSTEM.md,$FAKE_HOME/.pi/agent/APPEND_SYSTEM.md"
PROFILE_CODEX_CONFIG="$FAKE_HOME/.config/yolo/foo/codex/home/config.toml"
# By default the profile reads the main codex config read-only; trust comes
# from a -c override on the codex command line instead of a rewritten file.
assert_contains \
  "named profile re-shares the codex config read-only" \
  "$OUT" \
  $'--ro-bind\n'"$FAKE_HOME/.codex/config.toml,$FAKE_HOME/.codex/config.toml"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ -e "$PROFILE_CODEX_CONFIG" ]]; then
  echo "FAIL: named profile does not materialize a codex config by default"
  FAILURES=$((FAILURES + 1))
fi

# --enable=codex-config restores the writable, $PWD-trusted copy.
OUT="$(run_profile_yolo "$GLOBAL_CONFIG_HOME" --enable=codex-config)"
assert_not_contains \
  "codex-config profile does not re-share the codex config read-only" \
  "$OUT" \
  "$FAKE_HOME/.codex/config.toml,$FAKE_HOME/.codex/config.toml"
assert_contains \
  "named profile seeds its codex config from the main profile" \
  "$(cat "$PROFILE_CODEX_CONFIG")" \
  "x"
assert_contains \
  "named profile trusts the launch directory" \
  "$(cat "$PROFILE_CODEX_CONFIG")" \
  "[projects.\"$PROJECT_DIR\"]"

# A profile launched once into a directory it already trusts must still pick up
# later changes to the main config.
printf 'x\nmain-profile-edit\n' > "$FAKE_HOME/.codex/config.toml"
OUT="$(run_profile_yolo "$GLOBAL_CONFIG_HOME" --enable=codex-config)"
assert_contains \
  "relaunch re-syncs the profile codex config with the main profile" \
  "$(cat "$PROFILE_CODEX_CONFIG")" \
  "main-profile-edit"
assert_contains \
  "relaunch keeps trusting the launch directory" \
  "$(cat "$PROFILE_CODEX_CONFIG")" \
  "[projects.\"$PROJECT_DIR\"]"
printf 'x\n' > "$FAKE_HOME/.codex/config.toml"

# Tag gating: audio is on by default, display passthrough (Wayland + X11) is off
# by default, and --disable beats --enable for the same tag.
FAKE_XDG="$WORKDIR/xdg"
mkdir -p "$FAKE_XDG"
WAYLAND_SOCKET="$FAKE_XDG/wayland-9"
_python_path="$(command -v python3)"
if [[ -z "$_python_path" ]]; then
  echo "FATAL: python3 is required to bind the socket fixtures" >&2
  exit 1
fi
bind_unix_socket() {
  "$_python_path" - "$1" <<'PY'
import socket
import sys

sock = socket.socket(socket.AF_UNIX)
sock.bind(sys.argv[1])
sock.close()
PY
}
bind_unix_socket "$WAYLAND_SOCKET"

# The X11 socket directory is fixed by the protocol (/tmp/.X11-unix), so the
# fixture has to live there. Display :99 is outside the range a real session
# uses; create it only if absent and remove exactly what we created.
X11_SOCKET="/tmp/.X11-unix/X99"
X11_FIXTURE=0
if mkdir -p /tmp/.X11-unix 2>/dev/null && [[ ! -e "$X11_SOCKET" ]] \
   && bind_unix_socket "$X11_SOCKET" 2>/dev/null; then
  X11_FIXTURE=1
  trap 'rm -f "$X11_SOCKET"; rm -rf "$WORKDIR"' EXIT
fi

XAUTH_FILE="$FAKE_HOME/.Xauthority"
printf 'fake-cookie\n' > "$XAUTH_FILE"

TEST_WAYLAND_DISPLAY="wayland-9"
TEST_DISPLAY=":99"

run_yolo() {
  {
    cd "$PROJECT_DIR" &&
      HOME="$FAKE_HOME" \
      XDG_RUNTIME_DIR="$FAKE_XDG" \
      WAYLAND_DISPLAY="$TEST_WAYLAND_DISPLAY" \
      DISPLAY="$TEST_DISPLAY" \
      XAUTHORITY="$XAUTH_FILE" \
      YOLO_LLM_SANDBOX="$FAKE_BIN/record-sandbox" \
      YOLO_SANDBOX_ENTRYPOINT="$(command -v true)" \
      YOLO_NIX_LD="$(command -v true)" \
      YOLO_JQ="$(command -v jq)" \
      YOLO_TASKSET="$(command -v taskset)" \
      YOLO_CUSTOM_PROMPT="$SCRIPT_DIR/custom-prompt.sh" \
      bash "$SCRIPT" "$@"
  } 2>&1
}

run_yolo_cmd() { run_yolo "$@" --profile foo cmd true; }

AGENT_HOOKS='[{"command":"printf agent-hook","tags":[]}]'
SHELL_HOOKS='[{"command":"printf shell-hook","tags":[]}]'
CMD_HOOKS='[{"command":"printf cmd-hook","tags":[]}]'

OUT="$(YOLO_SANDBOX_HOOKS_JSON="$AGENT_HOOKS" YOLO_SHELL_HOOKS_JSON="$SHELL_HOOKS" YOLO_CMD_HOOKS_JSON="$CMD_HOOKS" run_yolo --profile foo pi)"
assert_contains "agent subcommand selects sandbox hooks" "$OUT" "agent-hook"
assert_not_contains "agent subcommand excludes shell hooks" "$OUT" "shell-hook"
assert_not_contains "agent subcommand excludes cmd hooks" "$OUT" "cmd-hook"

OUT="$(YOLO_SANDBOX_HOOKS_JSON="$AGENT_HOOKS" YOLO_SHELL_HOOKS_JSON="$SHELL_HOOKS" YOLO_CMD_HOOKS_JSON="$CMD_HOOKS" run_yolo --profile foo shell)"
assert_contains "shell subcommand selects shell hooks" "$OUT" "shell-hook"
assert_not_contains "shell subcommand excludes sandbox hooks" "$OUT" "agent-hook"
assert_not_contains "shell subcommand excludes cmd hooks" "$OUT" "cmd-hook"

OUT="$(YOLO_SANDBOX_HOOKS_JSON="$AGENT_HOOKS" YOLO_SHELL_HOOKS_JSON="$SHELL_HOOKS" YOLO_CMD_HOOKS_JSON="$CMD_HOOKS" run_yolo --profile foo cmd true)"
assert_contains "cmd subcommand selects cmd hooks" "$OUT" "cmd-hook"
assert_not_contains "cmd subcommand excludes sandbox hooks" "$OUT" "agent-hook"
assert_not_contains "cmd subcommand excludes shell hooks" "$OUT" "shell-hook"

OUT="$(run_yolo_cmd)"
assert_not_contains "wayland socket is not bound by default" "$OUT" "$WAYLAND_SOCKET"
assert_not_contains "WAYLAND_DISPLAY is not set by default" "$OUT" "WAYLAND_DISPLAY=wayland-9"
assert_contains "audio socket is bound by default" "$OUT" "$FAKE_XDG/pipewire-0"
assert_not_contains "dynamic gpu devices are not bound by default" "$OUT" "/dev/dri,/dev/dri"

OUT="$(run_yolo_cmd --enable=gpu)"
assert_not_contains "--enable=gpu does not enable dynamic passthrough" "$OUT" "/dev/dri,/dev/dri"

OUT="$(run_yolo_cmd --enable=dyngpu)"
STATUS=$?
assert_eq "--enable=dyngpu remains non-fatal" "0" "$STATUS"
assert_contains "--enable=dyngpu binds DRM devices" "$OUT" "/dev/dri,/dev/dri"
assert_contains "--enable=dyngpu binds AMD KFD" "$OUT" "/dev/kfd,/dev/kfd"
assert_contains "--enable=dyngpu binds NVIDIA control devices" "$OUT" "/dev/nvidiactl,/dev/nvidiactl"
assert_contains "--enable=dyngpu binds NVIDIA render devices" "$OUT" "/dev/nvidia0,/dev/nvidia0"
assert_contains "--enable=dyngpu binds NixOS graphics and Vulkan drivers" "$OUT" "/run/opengl-driver"
assert_contains "--enable=dyngpu binds 32-bit graphics and Vulkan drivers" "$OUT" "/run/opengl-driver-32"
assert_contains "--enable=dyngpu binds device metadata" "$OUT" "/sys"
if [[ ! -e /dev/dri && ! -e /dev/kfd && ! -e /dev/nvidiactl && ! -e /dev/nvidia0 ]]; then
  assert_contains "--enable=dyngpu warns when GPU devices are absent" "$OUT" "no GPU device nodes found"
fi

OUT="$(run_yolo_cmd --enable=dyngpu --disable=dyngpu)"
assert_not_contains "--disable drops enabled dynamic gpu devices" "$OUT" "/dev/dri,/dev/dri"

STATIC_GPU_RECORD=$'/dev/static-gpu\tgpu'
OUT="$(YOLO_EXTRA_DEV_PATHS="$STATIC_GPU_RECORD" run_yolo_cmd --disable=dyngpu)"
assert_contains "--disable=dyngpu preserves static gpu devices" "$OUT" "/dev/static-gpu,/dev/static-gpu"

OUT="$(YOLO_EXTRA_DEV_PATHS="$STATIC_GPU_RECORD" run_yolo_cmd --disable=gpu)"
assert_not_contains "--disable=gpu drops static gpu devices" "$OUT" "/dev/static-gpu,/dev/static-gpu"

OUT="$(YOLO_EXTRA_DEV_PATHS="$STATIC_GPU_RECORD" run_yolo_cmd --enable=dyngpu --disable=gpu)"
assert_contains "--disable=gpu preserves enabled dynamic gpu devices" "$OUT" "/dev/dri,/dev/dri"
assert_not_contains "--disable=gpu still drops static gpu devices with dyngpu enabled" "$OUT" "/dev/static-gpu,/dev/static-gpu"

OUT="$(run_yolo_cmd --enable=display)"
assert_contains "--enable=display binds the wayland socket" "$OUT" "$WAYLAND_SOCKET"
assert_contains "--enable=display sets WAYLAND_DISPLAY" "$OUT" "WAYLAND_DISPLAY=wayland-9"
assert_contains "--enable=display sets XDG_RUNTIME_DIR" "$OUT" "XDG_RUNTIME_DIR=$FAKE_XDG"

OUT="$(run_yolo_cmd --enable=other,display)"
assert_contains "--enable is comma-separated" "$OUT" "$WAYLAND_SOCKET"

OUT="$(run_yolo_cmd --enable=display --disable=display)"
assert_not_contains "--disable beats a preceding --enable" "$OUT" "$WAYLAND_SOCKET"

OUT="$(run_yolo_cmd --disable=display --enable=display)"
assert_not_contains "--disable beats a following --enable" "$OUT" "$WAYLAND_SOCKET"

OUT="$(run_yolo_cmd --enable=audio --disable=audio)"
assert_not_contains "--enable does not resurrect a disabled default-on tag" "$OUT" "$FAKE_XDG/pipewire-0"

# The VM capability is configured by the package wrapper through a trusted,
# absolute state-directory path. It must bind only that persistent directory
# and /dev/kvm, and --disable=vm must remove both capabilities for the run.
VM_STATE_DIR="$WORKDIR/vms"
OUT="$(YOLO_VM_STATE_DIR="$VM_STATE_DIR" run_yolo_cmd)"
assert_contains "configured VM capability binds KVM only" "$OUT" "/dev/kvm,/dev/kvm"
assert_contains "configured VM capability binds its persistent state" "$OUT" "$VM_STATE_DIR"
assert_contains "configured VM capability exports its state path" "$OUT" "YOLO_VM_STATE_DIR=$VM_STATE_DIR"
assert_not_contains "configured VM capability does not bind host TUN" "$OUT" "/dev/net/tun"
assert_not_contains "configured VM capability does not bind a libvirt socket" "$OUT" "libvirt-sock"
assert_not_contains "configured VM capability does not bind an Incus socket" "$OUT" "incus/unix.socket"
assert_eq "configured VM capability creates its state directory" "directory" \
  "$([[ -d "$VM_STATE_DIR" ]] && printf directory || printf missing)"

OUT="$(YOLO_VM_STATE_DIR="$VM_STATE_DIR" run_yolo_cmd --disable=vm)"
assert_not_contains "--disable=vm drops KVM" "$OUT" "/dev/kvm,/dev/kvm"
assert_not_contains "--disable=vm drops persistent VM state" "$OUT" "$VM_STATE_DIR"

OUT="$(YOLO_VM_STATE_DIR=relative/path run_yolo_cmd)"
STATUS=$?
assert_eq "relative VM state path is rejected" "1" "$STATUS"
assert_contains "relative VM state path fails explicitly" "$OUT" "must be absolute"

SANDBOX_BIN="$WORKDIR/sandbox-bin"
mkdir -p "$SANDBOX_BIN"
OUT="$(YOLO_SANDBOX_BIN="$SANDBOX_BIN" run_yolo_cmd)"
assert_contains \
  "sandbox package directory remains available to child shells" \
  "$OUT" \
  "YOLO_SANDBOX_BIN=$SANDBOX_BIN"

TEST_WAYLAND_DISPLAY="wayland-absent"
OUT="$(run_yolo_cmd --enable=display)"
assert_contains "missing wayland socket warns" "$OUT" "no Wayland socket at"
TEST_WAYLAND_DISPLAY="wayland-9"

# X11 / XWayland leg of the same tag. /tmp is a tmpfs inside the sandbox, so the
# X socket and the auth file must be bound explicitly.
if [[ $X11_FIXTURE -eq 1 ]]; then
  OUT="$(run_yolo_cmd)"
  assert_not_contains "x11 socket is not bound by default" "$OUT" "$X11_SOCKET"

  OUT="$(run_yolo_cmd --enable=display)"
  assert_contains "--enable=display binds the x11 socket" "$OUT" "$X11_SOCKET"
  assert_contains "--enable=display sets DISPLAY" "$OUT" "DISPLAY=:99"
  assert_contains "--enable=display binds the x11 auth file" "$OUT" "$XAUTH_FILE"
  assert_contains "--enable=display sets XAUTHORITY" "$OUT" "XAUTHORITY=$XAUTH_FILE"

  TEST_DISPLAY=":99.0"
  OUT="$(run_yolo_cmd --enable=display)"
  assert_contains "screen suffix resolves to the same x11 socket" "$OUT" "$X11_SOCKET"

  TEST_DISPLAY=":99"
  OUT="$(run_yolo_cmd --enable=display --disable=display)"
  assert_not_contains "--disable drops the x11 socket too" "$OUT" "$X11_SOCKET"
else
  echo "SKIP: could not create the $X11_SOCKET fixture; x11 bind assertions skipped"
fi

TEST_DISPLAY=":98"
OUT="$(run_yolo_cmd --enable=display)"
assert_contains "missing x11 socket warns" "$OUT" "no X11 socket at /tmp/.X11-unix/X98"

TEST_DISPLAY="remotehost:0"
OUT="$(run_yolo_cmd --enable=display)"
assert_not_contains "non-local DISPLAY is left to the shared network namespace" "$OUT" "no X11 socket at"
TEST_DISPLAY=":99"

OUT="$(run_yolo --help)"
assert_contains "usage documents --enable" "$OUT" "--enable=TAG"
assert_contains "usage documents dynamic gpu passthrough" "$OUT" "dyngpu"
assert_contains "usage documents VM capability tag" "$OUT" "vm"

# Ad-hoc CLI binds must be appended after every built-in bind: bwrap applies
# mounts in argv order, so the last bind covering a path wins.
CLI_RO="$WORKDIR/cli-ro"
CLI_RW="$WORKDIR/cli-rw"
DECL_RO="$WORKDIR/decl-ro"
DECL_RW="$WORKDIR/decl-rw"
mkdir -p "$CLI_RO" "$CLI_RW" "$DECL_RO" "$DECL_RW"

arg_index() {
  printf '%s\n' "$1" | grep -n -x -F -- "$2" | tail -1 | cut -d: -f1
}

assert_after() {
  local desc="$1" haystack="$2" later="$3" earlier="$4"
  local later_idx earlier_idx
  later_idx="$(arg_index "$haystack" "$later")"
  earlier_idx="$(arg_index "$haystack" "$earlier")"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -z "$later_idx" || -z "$earlier_idx" || "$later_idx" -le "$earlier_idx" ]]; then
    echo "FAIL: $desc -- expected [$later] ($later_idx) after [$earlier] ($earlier_idx)"
    FAILURES=$((FAILURES + 1))
  fi
}

OUT="$(YOLO_EXTRA_RO_PATHS="$DECL_RO" YOLO_EXTRA_RW_PATHS="$DECL_RW" \
  run_yolo --profile foo --ro "$CLI_RO" --rw "$CLI_RW" cmd true)"
assert_after "CLI --ro follows the declarative read-only binds" "$OUT" "$CLI_RO" "$DECL_RO"
assert_after "CLI --ro follows the declarative read-write binds" "$OUT" "$CLI_RO" "$DECL_RW"
assert_after "CLI --ro follows the built-in \$PWD bind" "$OUT" "$CLI_RO" "$PROJECT_DIR"
assert_after "CLI --ro follows the built-in agents-registry bind" "$OUT" "$CLI_RO" "$FAKE_HOME/.agents"
assert_after "CLI --ro follows the profile claude binds" "$OUT" \
  "$CLI_RO" "$FAKE_HOME/.config/yolo/foo/claude/home,$FAKE_HOME/.claude"
assert_after "CLI --ro follows the profile pi binds" "$OUT" \
  "$CLI_RO" "$FAKE_HOME/.pi/agent/mcp.json,$FAKE_HOME/.pi/agent/mcp.json"
assert_after "CLI --rw follows the CLI --ro that preceded it" "$OUT" "$CLI_RW" "$CLI_RO"
assert_after "the sandbox command separator still follows the CLI binds" "$OUT" "--" "$CLI_RW"

# Declarative (home-manager) extras sit between the two: after every built-in
# bind including the profile-specific ones, but still under the CLI binds.
assert_after "declarative --ro follows the built-in agents-registry bind" "$OUT" \
  "$DECL_RO" "$FAKE_HOME/.agents"
assert_after "declarative --ro follows the profile claude re-shares" "$OUT" \
  "$DECL_RO" "$FAKE_HOME/.claude/settings.json,$FAKE_HOME/.claude/settings.json"
assert_after "declarative --rw follows the profile pi binds" "$OUT" \
  "$DECL_RW" "$FAKE_HOME/.pi/agent/mcp.json,$FAKE_HOME/.pi/agent/mcp.json"
assert_after "CLI --ro follows the declarative extras" "$OUT" "$CLI_RO" "$DECL_RW"

# --bind / --ro-bind SRC,DST remap a host path onto a different sandbox path.
# They join the ad-hoc list in command-line order, after every other bind.
REMAP_RW="$WORKDIR/remap-rw"
REMAP_RO="$WORKDIR/remap-ro"
mkdir -p "$REMAP_RW" "$REMAP_RO"
# SRC is canonicalized, so compare against the canonical spelling.
REMAP_RW="$(realpath -- "$REMAP_RW")"
REMAP_RO="$(realpath -- "$REMAP_RO")"
OUT="$(YOLO_EXTRA_RW_PATHS="$DECL_RW" run_yolo --profile foo --ro "$CLI_RO" \
  --bind "$REMAP_RW,$FAKE_HOME/.config/tether" \
  --ro-bind "$REMAP_RO,$FAKE_HOME/.claude/remapped" cmd true)"
STATUS=$?
assert_eq "remap launch succeeds" "0" "$STATUS"
assert_contains "--bind is forwarded as a read-write remap" "$OUT" \
  $'--bind\n'"$REMAP_RW,$FAKE_HOME/.config/tether"
assert_contains "--ro-bind is forwarded as a read-only remap" "$OUT" \
  $'--ro-bind\n'"$REMAP_RO,$FAKE_HOME/.claude/remapped"
assert_after "--bind follows the CLI --ro that preceded it" "$OUT" \
  "$REMAP_RW,$FAKE_HOME/.config/tether" "$CLI_RO"
assert_after "--bind follows the declarative extras" "$OUT" \
  "$REMAP_RW,$FAKE_HOME/.config/tether" "$DECL_RW"
assert_after "--ro-bind follows the profile claude home bind" "$OUT" \
  "$REMAP_RO,$FAKE_HOME/.claude/remapped" "$FAKE_HOME/.config/yolo/foo/claude/home,$FAKE_HOME/.claude"
assert_after "--ro-bind follows the --bind that preceded it" "$OUT" \
  "$REMAP_RO,$FAKE_HOME/.claude/remapped" "$REMAP_RW,$FAKE_HOME/.config/tether"

# A relative SRC (run_yolo launches from $PROJECT_DIR) is canonicalized on the host.
OUT="$(run_yolo --bind "../remap-rw/../remap-rw,/opt/x" cmd true)"
assert_contains "--bind canonicalizes a relative source" "$OUT" \
  $'--bind\n'"$REMAP_RW,/opt/x"

# Unlike --ro/--rw, an explicit remap never disappears silently.
for _bad in "$WORKDIR/missing,/opt/x" "$REMAP_RW" "$REMAP_RW,relative/dst" \
    "$REMAP_RW,~/.config/tether" ",/opt/x"; do
  for _flag in --bind --ro-bind; do
    OUT="$(run_yolo "$_flag" "$_bad" cmd true)"
    STATUS=$?
    assert_eq "$_flag $_bad is refused" "1" "$STATUS"
    assert_not_contains "$_flag $_bad never reaches the sandbox" "$OUT" "SMIND_SANDBOXED=1"
  done
done
OUT="$(run_yolo --bind "$WORKDIR/missing,/opt/x" cmd true)"
assert_contains "missing remap source is reported" "$OUT" "source '$WORKDIR/missing' does not exist on the host"
OUT="$(run_yolo --bind "$REMAP_RW,~/.config/tether" cmd true)"
assert_contains "non-absolute remap destination is reported" "$OUT" "must be an absolute sandbox path"
# A comma-free SRC whose canonical path has a comma cannot be forwarded intact.
mkdir -p "$WORKDIR/a,b"
ln -s "$WORKDIR/a,b" "$WORKDIR/comma-link"
OUT="$(run_yolo --bind "$WORKDIR/comma-link,/opt/x" cmd true)"
STATUS=$?
assert_eq "remap source canonicalizing to a comma path is refused" "1" "$STATUS"
assert_contains "comma in the canonical remap source is reported" "$OUT" "contains a comma"
OUT="$(run_yolo --help)"
assert_contains "usage documents --bind" "$OUT" "--bind SRC,DST"
assert_contains "usage documents --ro-bind" "$OUT" "--ro-bind SRC,DST"

# --auth-override AGENT:PROFILE binds the other profile's credentials file
# read-write over the launched profile's, leaving its sessions/state in place.
WORK_CODEX_AUTH="$FAKE_HOME/.config/yolo/work/codex/home/auth.json"
WORK_CLAUDE_CREDS="$FAKE_HOME/.config/yolo/work/claude/home/.credentials.json"
WORK_PI_AUTH="$FAKE_HOME/.config/yolo/work/pi/home/agent/auth.json"
FOO_CODEX_AUTH="$FAKE_HOME/.config/yolo/foo/codex/home/auth.json"
FOO_CLAUDE_CREDS="$FAKE_HOME/.config/yolo/foo/claude/home/.credentials.json"
mkdir -p "$(dirname "$WORK_CODEX_AUTH")" "$(dirname "$WORK_CLAUDE_CREDS")" "$(dirname "$WORK_PI_AUTH")"
printf '{"work":"pi"}\n' > "$WORK_PI_AUTH"
printf '{"work":"codex"}\n' > "$WORK_CODEX_AUTH"
printf '{"work":"claude"}\n' > "$WORK_CLAUDE_CREDS"

OUT="$(run_yolo --profile foo --auth-override codex:work --auth-override claude:work cmd true)"
STATUS=$?
assert_eq "auth override launch succeeds" "0" "$STATUS"
assert_contains "codex auth override binds the source profile's auth.json read-write" "$OUT" \
  $'--bind\n'"$WORK_CODEX_AUTH,$FAKE_HOME/.codex/auth.json"
assert_contains "claude auth override binds the source profile's credentials read-write" "$OUT" \
  $'--bind\n'"$WORK_CLAUDE_CREDS,$FAKE_HOME/.claude/.credentials.json"
assert_after "codex auth override follows the profile codex home bind" "$OUT" \
  "$WORK_CODEX_AUTH,$FAKE_HOME/.codex/auth.json" "$FAKE_HOME/.config/yolo/foo/codex/home,$FAKE_HOME/.codex"
assert_after "claude auth override follows the profile claude home bind" "$OUT" \
  "$WORK_CLAUDE_CREDS,$FAKE_HOME/.claude/.credentials.json" "$FAKE_HOME/.config/yolo/foo/claude/home,$FAKE_HOME/.claude"
assert_not_contains "auth override keeps the launched profile's claude home" "$OUT" \
  "$FAKE_HOME/.config/yolo/work/claude/home,$FAKE_HOME/.claude"

OUT="$(run_yolo --profile foo --auth-override pi:work cmd true)"
STATUS=$?
assert_eq "pi auth override launch succeeds" "0" "$STATUS"
assert_contains "pi auth override binds the source profile's auth.json read-write" "$OUT" \
  $'--bind\n'"$WORK_PI_AUTH,$FAKE_HOME/.pi/agent/auth.json"
assert_after "pi auth override follows the profile pi home bind" "$OUT" \
  "$WORK_PI_AUTH,$FAKE_HOME/.pi/agent/auth.json" "$FAKE_HOME/.config/yolo/foo/pi/home,$FAKE_HOME/.pi"

OUT="$(run_yolo --auth-override codex:work cmd true)"
assert_contains "auth override applies to the default profile" "$OUT" \
  $'--bind\n'"$WORK_CODEX_AUTH,$FAKE_HOME/.codex/auth.json"

OUT="$(run_yolo --profile foo --auth-override codex:missing cmd true)"
STATUS=$?
assert_eq "auth override without source credentials is refused" "1" "$STATUS"
assert_contains "missing source credentials are named" "$OUT" \
  "$FAKE_HOME/.config/yolo/missing/codex/home/auth.json"

OUT="$(run_yolo --profile work --auth-override codex:work cmd true)"
STATUS=$?
assert_eq "auth override from the launched profile itself is refused" "1" "$STATUS"

OUT="$(run_yolo --profile foo --auth-override gemini:work cmd true)"
STATUS=$?
assert_eq "auth override for an unsupported agent is refused" "1" "$STATUS"

OUT="$(run_yolo --profile foo --auth-override codex:work --auth-override codex:other cmd true)"
STATUS=$?
assert_eq "two auth overrides for one agent are refused" "1" "$STATUS"

OUT="$(run_yolo --profile foo --auth-override codex:../x cmd true)"
STATUS=$?
assert_eq "auth override with an invalid profile name is refused" "1" "$STATUS"

# bwrap creates an empty mountpoint file when the launched profile has no
# credentials of its own; yolo removes it on exit so the profile is not left
# with an empty (invalid) credentials file. Existing credentials are untouched.
printf '%s\n' \
  "#!$_bash_path" \
  ": > \"$FOO_CODEX_AUTH\"" \
  "[[ -e \"$FOO_CLAUDE_CREDS\" ]] || : > \"$FOO_CLAUDE_CREDS\"" \
  > "$FAKE_BIN/mountpoint-sandbox"
chmod +x "$FAKE_BIN/mountpoint-sandbox"
rm -f "$FOO_CODEX_AUTH"
printf '{"foo":"claude"}\n' > "$FOO_CLAUDE_CREDS"
(
  cd "$PROJECT_DIR" && HOME="$FAKE_HOME" \
    YOLO_LLM_SANDBOX="$FAKE_BIN/mountpoint-sandbox" \
    YOLO_SANDBOX_ENTRYPOINT="$(command -v true)" \
    YOLO_NIX_LD="$(command -v true)" \
    YOLO_JQ="$(command -v jq)" \
    YOLO_TASKSET="$(command -v taskset)" \
    YOLO_CUSTOM_PROMPT="$SCRIPT_DIR/custom-prompt.sh" \
    bash "$SCRIPT" --profile foo --auth-override codex:work --auth-override claude:work cmd true
)
TESTS_RUN=$((TESTS_RUN + 1))
if [[ -e "$FOO_CODEX_AUTH" ]]; then
  echo "FAIL: auth override removes the mountpoint file it caused"
  FAILURES=$((FAILURES + 1))
fi
assert_eq "auth override leaves the launched profile's own credentials untouched" \
  '{"foo":"claude"}' "$(cat "$FOO_CLAUDE_CREDS")"
assert_eq "auth override leaves the source credentials untouched" \
  '{"work":"codex"}' "$(cat "$WORK_CODEX_AUTH")"

# Claude treats the sandboxed workspace as trusted (no trust dialog) whenever
# CLAUDE_CODE_SANDBOXED is set; yolo sets it for every subcommand.
for _subcmd in claude codex pi "cmd true"; do
  # shellcheck disable=SC2086
  OUT="$(run_yolo --profile foo $_subcmd)"
  assert_contains "$_subcmd: CLAUDE_CODE_SANDBOXED is set in the sandbox" "$OUT" $'--env\nCLAUDE_CODE_SANDBOXED=1'
done

# codex trusts $PWD through a -c override; the default profile's config file
# is left alone unless --enable=codex-config asks for the rewritten copy.
CODEX_TRUST_OVERRIDE="projects={\"$PROJECT_DIR\"={trust_level=\"trusted\"}}"
OUT="$(run_yolo codex)"
assert_contains "codex launch trusts \$PWD via a -c override" "$OUT" $'-c\n'"$CODEX_TRUST_OVERRIDE"
assert_contains "codex launch keeps mouse selection with tmux via a -c override" "$OUT" $'-c\ntui.fullscreen_transcript=false'
assert_eq "default profile codex config is left untouched" "x" "$(cat "$FAKE_HOME/.codex/config.toml")"
OUT="$(run_yolo --profile foo codex)"
assert_contains "named profile codex launch trusts \$PWD via a -c override" "$OUT" $'-c\n'"$CODEX_TRUST_OVERRIDE"
OUT="$(run_yolo --enable=codex-config codex)"
assert_contains "codex-config default profile trusts \$PWD in the rewritten config" \
  "$(cat "$FAKE_HOME/.codex/config.toml")" "[projects.\"$PROJECT_DIR\"]"
printf 'x\n' > "$FAKE_HOME/.codex/config.toml"

# --list-profiles / --delete-profile manage ~/.config/yolo/<name> host-side and
# exit without launching the sandbox (so they also work from $HOME).
mkdir -p "$FAKE_HOME/.config/yolo/zeta/claude"
: > "$FAKE_HOME/.config/yolo/not-a-profile"
OUT="$(run_yolo --list-profiles)"
STATUS=$?
assert_eq "list profiles succeeds" "0" "$STATUS"
assert_eq "list profiles prints each profile dir name, sorted" $'foo\nwork\nzeta' "$OUT"
OUT="$(cd "$FAKE_HOME" && HOME="$FAKE_HOME" YOLO_LLM_SANDBOX=x YOLO_SANDBOX_ENTRYPOINT=x YOLO_NIX_LD=x \
  YOLO_JQ=x YOLO_TASKSET=x YOLO_CUSTOM_PROMPT="$SCRIPT_DIR/custom-prompt.sh" bash "$SCRIPT" --list-profiles 2>&1)"
assert_eq "list profiles works from \$HOME" $'foo\nwork\nzeta' "$OUT"
OUT="$(run_yolo --list-profiles claude)"
STATUS=$?
assert_eq "list profiles rejects a trailing subcommand" "1" "$STATUS"

BACKUP_ROOT="$FAKE_HOME/.local/share/yolo/deleted-profiles"
OUT="$(run_yolo --delete-profile zeta </dev/null)"
STATUS=$?
assert_eq "profile deletion moves to backup without prompting" "0" "$STATUS"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ -e "$FAKE_HOME/.config/yolo/zeta" ]]; then
  echo "FAIL: profile deletion removes the profile from ~/.config/yolo"
  FAILURES=$((FAILURES + 1))
fi
BACKUPS=("$BACKUP_ROOT"/zeta-*)
assert_eq "profile deletion leaves exactly one backup" "1" "${#BACKUPS[@]}"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ ! -d "${BACKUPS[0]}/claude" ]]; then
  echo "FAIL: profile backup keeps the profile contents"
  FAILURES=$((FAILURES + 1))
fi
assert_contains "profile deletion reports the backup path" "$OUT" "${BACKUPS[0]}"
OUT="$(run_yolo --list-profiles)"
assert_eq "backed-up profile is no longer listed" $'foo\nwork' "$OUT"

mkdir -p "$FAKE_HOME/.config/yolo/zeta/claude"
OUT="$(printf 'n\n' | run_yolo --delete-profile zeta --purge)"
STATUS=$?
assert_eq "declined purge exits non-zero" "1" "$STATUS"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ ! -d "$FAKE_HOME/.config/yolo/zeta" ]]; then
  echo "FAIL: declined purge keeps the profile"
  FAILURES=$((FAILURES + 1))
fi
OUT="$(printf 'y\n' | run_yolo --delete-profile zeta --purge)"
STATUS=$?
assert_eq "confirmed purge succeeds" "0" "$STATUS"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ -e "$FAKE_HOME/.config/yolo/zeta" ]]; then
  echo "FAIL: confirmed purge removes the profile dir"
  FAILURES=$((FAILURES + 1))
fi
BACKUPS=("$BACKUP_ROOT"/zeta-*)
assert_eq "purge makes no backup" "1" "${#BACKUPS[@]}"
OUT="$(run_yolo --purge cmd true)"
STATUS=$?
assert_eq "--purge without --delete-profile is refused" "1" "$STATUS"
OUT="$(printf 'y\n' | run_yolo --delete-profile zeta)"
STATUS=$?
assert_eq "deleting a missing profile is refused" "1" "$STATUS"
assert_contains "missing profile deletion names the profile" "$OUT" "profile 'zeta' does not exist"
OUT="$(printf 'y\n' | run_yolo --delete-profile ..)"
STATUS=$?
assert_eq "deleting an invalid profile name is refused" "1" "$STATUS"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ ! -d "$FAKE_HOME/.config/yolo/foo" ]]; then
  echo "FAIL: invalid profile name deletion leaves siblings intact"
  FAILURES=$((FAILURES + 1))
fi
OUT="$(run_yolo --delete-profile)"
STATUS=$?
assert_eq "delete profile without a name is refused" "1" "$STATUS"

# --copy-sessions AGENT:SRC:DST copies session files into DST without
# overwriting anything DST already has.
CS_SRC="$FAKE_HOME/.config/yolo/cs-src"
CS_DST="$FAKE_HOME/.config/yolo/cs-dst"
mkdir -p "$CS_SRC/claude/home/projects/-p/s1/subagents" "$CS_SRC/claude/home/projects/-p/memory" \
  "$CS_SRC/claude/home/file-history/s1" \
  "$CS_SRC/codex/home/sessions/2026/09/29" "$CS_SRC/codex/home/archived_sessions" \
  "$CS_SRC/pi/home/agent/sessions/--p--" \
  "$CS_DST/claude/home/projects/-p" "$CS_DST/codex/home/sessions/2026/09/29"
printf 'src\n' > "$CS_SRC/claude/home/projects/-p/s1.jsonl"
printf 'sub\n' > "$CS_SRC/claude/home/projects/-p/s1/subagents/a.jsonl"
printf 'mem\n' > "$CS_SRC/claude/home/projects/-p/memory/MEMORY.md"
printf 'fh\n' > "$CS_SRC/claude/home/file-history/s1/v1"
printf 'dst\n' > "$CS_DST/claude/home/projects/-p/s1.jsonl"
printf 'own\n' > "$CS_DST/claude/home/projects/-p/s2.jsonl"
printf 'a\n' > "$CS_SRC/codex/home/sessions/2026/09/29/rollout-a.jsonl"
printf 'b\n' > "$CS_SRC/codex/home/archived_sessions/rollout-b.jsonl"
printf 'c\n' > "$CS_DST/codex/home/sessions/2026/09/29/rollout-c.jsonl"
printf 'x\n' > "$CS_SRC/pi/home/agent/sessions/--p--/x.jsonl"
"$YOLO_SQLITE" "$CS_DST/codex/home/state_5.sqlite" \
  "CREATE TABLE backfill_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL, last_watermark TEXT, last_success_at INTEGER, updated_at INTEGER NOT NULL);
   INSERT INTO backfill_state VALUES (1, 'complete', 'sessions/2026/09/29/rollout-c.jsonl', 1, 1);"

OUT="$(run_yolo --copy-sessions claude:cs-src:cs-dst)"
STATUS=$?
assert_eq "claude session copy succeeds" "0" "$STATUS"
assert_eq "claude session copy keeps DST's version of a shared session" "dst" "$(cat "$CS_DST/claude/home/projects/-p/s1.jsonl")"
assert_eq "claude session copy keeps DST-only sessions" "own" "$(cat "$CS_DST/claude/home/projects/-p/s2.jsonl")"
assert_eq "claude session copy includes subagent transcripts" "sub" "$(cat "$CS_DST/claude/home/projects/-p/s1/subagents/a.jsonl" 2>&1)"
assert_eq "claude session copy includes file history" "fh" "$(cat "$CS_DST/claude/home/file-history/s1/v1" 2>&1)"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ -e "$CS_DST/claude/home/projects/-p/memory" ]]; then
  echo "FAIL: claude session copy leaves project memory behind"
  FAILURES=$((FAILURES + 1))
fi
assert_contains "claude session copy reports counts" "$OUT" "copied 2 file(s), kept 1 already in 'cs-dst'"

OUT="$(run_yolo --copy-sessions codex:cs-src:cs-dst)"
STATUS=$?
assert_eq "codex session copy succeeds" "0" "$STATUS"
assert_eq "codex session copy copies active rollouts" "a" "$(cat "$CS_DST/codex/home/sessions/2026/09/29/rollout-a.jsonl" 2>&1)"
assert_eq "codex session copy copies archived rollouts" "b" "$(cat "$CS_DST/codex/home/archived_sessions/rollout-b.jsonl" 2>&1)"
assert_eq "codex session copy keeps DST rollouts" "c" "$(cat "$CS_DST/codex/home/sessions/2026/09/29/rollout-c.jsonl")"
assert_eq "codex session copy re-arms the state DB backfill" "pending|" \
  "$("$YOLO_SQLITE" "$CS_DST/codex/home/state_5.sqlite" "SELECT status || '|' || ifnull(last_watermark, '') FROM backfill_state")"

OUT="$(run_yolo --copy-sessions pi:cs-src:cs-dst)"
STATUS=$?
assert_eq "pi session copy succeeds" "0" "$STATUS"
assert_eq "pi session copy copies sessions" "x" "$(cat "$CS_DST/pi/home/agent/sessions/--p--/x.jsonl" 2>&1)"

OUT="$(run_yolo --copy-sessions pi:cs-src:cs-dst)"
assert_contains "repeated session copy copies nothing new" "$OUT" "copied 0 file(s), kept 1 already in 'cs-dst'"

for _bad in "gemini:cs-src:cs-dst" "codex:cs-src" "codex:cs-src:cs-src" "codex:cs-src:missing" \
    "codex:missing:cs-dst" "codex:../x:cs-dst"; do
  OUT="$(run_yolo --copy-sessions "$_bad")"
  STATUS=$?
  assert_eq "--copy-sessions $_bad is refused" "1" "$STATUS"
done
OUT="$(run_yolo --copy-sessions codex:cs-src:cs-dst cmd true)"
STATUS=$?
assert_eq "--copy-sessions rejects a trailing subcommand" "1" "$STATUS"
rm -rf "$CS_SRC" "$CS_DST"

OUT="$(run_yolo --work cmd true)"
STATUS=$?
assert_eq "retired --work alias is an unknown flag" "1" "$STATUS"
assert_contains "retired --work alias reports an unknown flag" "$OUT" "Unknown flag: --work"

if [[ $FAILURES -ne 0 ]]; then
  echo "$FAILURES of $TESTS_RUN tests failed"
  exit 1
fi
echo "All $TESTS_RUN tests passed"
