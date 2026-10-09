#!/usr/bin/env bash
set -euo pipefail

BIND_SPECS=()
ENVS=()
CONFINE_SOCKET=""

show_help() {
  cat <<EOF
Usage: llm-sandbox [OPTIONS] -- COMMAND [ARGS...]

Wrapper around bubblewrap with simplified path whitelisting.

Options:
  --rw PATH        Add read-write path (only if exists)
  --ro PATH        Add read-only path (only if exists)
  --bind SRC,DST      Bind mount SRC to DST inside sandbox (read-write)
  --ro-bind SRC,DST   Bind mount SRC to DST inside sandbox (read-only)
  --dev-bind SRC,DST  Bind mount SRC to DST inside sandbox, allowing device access
  --confine-socket PATH  Unix socket that must stay unreachable inside the
                         sandbox: omit binds of the socket itself and mask
                         its projected destination under every covering bind
  --env VAR=VALUE     Set environment variable inside sandbox
  --help           Show this help

Environment:
  LLM_SANDBOX_NET_HELPER  Give the sandbox a network namespace of its own
                          instead of the host's, and run this program with the
                          sandbox's PID before COMMAND starts; it connects that
                          namespace (e.g. with pasta) and exits 0 once it has.

Example:
  llm-sandbox --rw "\$PWD" --env FOO=bar -- myapp --flag
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rw|--ro|--bind|--ro-bind|--dev-bind)
      BIND_SPECS+=("${1#--}"$'\t'"$2")
      shift 2
      ;;
    --confine-socket)
      CONFINE_SOCKET="$2"
      shift 2
      ;;
    --env)
      ENVS+=("$2")
      shift 2
      ;;
    --help)
      show_help
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ $# -eq 0 ]]; then
  echo "Error: No command specified" >&2
  exit 1
fi

BWRAP_ARGS=(
  --unshare-all
  --share-net
  --die-with-parent
  --clearenv
  --dev /dev
  --proc /proc
  --tmpfs /tmp
  --dir /var
  --symlink /run /var/run
)

# Keep process identity, terminal and Nix runtime settings, locale, and XDG
# locations. The NixOS initialization sentinel prevents child shells from
# replacing the explicitly constructed PATH. Callers add integrations and
# credentials explicitly with --env.
BASE_ENV_NAMES=(
  HOME USER LOGNAME SHELL PATH TERM COLORTERM TERMINFO_DIRS TERM_PROGRAM TERM_PROGRAM_VERSION
  LANG LANGUAGE LOCALE_ARCHIVE XDG_SESSION_TYPE
  LC_ALL LC_CTYPE LC_MESSAGES LC_COLLATE LC_NUMERIC LC_TIME LC_MONETARY
  LC_PAPER LC_NAME LC_ADDRESS LC_TELEPHONE LC_MEASUREMENT LC_IDENTIFICATION
  XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_STATE_HOME XDG_RUNTIME_DIR
  XDG_CONFIG_DIRS XDG_DATA_DIRS TZ TZDIR EDITOR VISUAL PAGER GIT_PAGER GH_PAGER NO_COLOR
  NIX_LD NIX_LD_LIBRARY_PATH NIX_PATH NIX_PROFILES NIX_USER_PROFILE_DIR
  NIX_DEBUG_INFO_DIRS NIXPKGS_CONFIG NIX_SSL_CERT_FILE SSL_CERT_FILE
  __NIXOS_SET_ENVIRONMENT_DONE
)
for name in "${BASE_ENV_NAMES[@]}"; do
  if [[ -v "$name" ]]; then
    BWRAP_ARGS+=(--setenv "$name" "${!name}")
  fi
done

# Host↔sandbox exchange directory.
#
# /tmp/exchange is a shared sticky directory (1777, root-owned): any user can
# create an entry, and only the entry owner or root can unlink it. The
# directory owner can also unlink entries, so a user-owned parent is not
# multi-user safe — a NixOS tmpfiles rule must create it as root:root
# (`d /tmp/exchange 1777 root root -`). This process creates only
# /tmp/exchange/$USER mode 0700 and bind-mounts that path at the same absolute
# path. SMIND_EXCHANGE_DIR is set to it after caller --env, so the variable
# cannot name a directory that was not bound. Plain 0777 is not used: without
# the sticky bit any user can replace another user's subdirectory.
EXCHANGE_ROOT="/tmp/exchange"

exchange_die() {
  echo "llm-sandbox: $*" >&2
  exit 1
}

if [[ -L "$EXCHANGE_ROOT" ]]; then
  exchange_die "exchange parent '$EXCHANGE_ROOT' is a symlink; refusing"
fi
if [[ ! -e "$EXCHANGE_ROOT" ]]; then
  mkdir -m 1777 -- "$EXCHANGE_ROOT" 2>/dev/null || true
fi
if [[ -L "$EXCHANGE_ROOT" || ! -d "$EXCHANGE_ROOT" ]]; then
  exchange_die "exchange parent '$EXCHANGE_ROOT' is missing or not a directory. Create it as root with mode 1777 (systemd-tmpfiles rule: d /tmp/exchange 1777 root root -)"
fi
if [[ -O "$EXCHANGE_ROOT" || "$(id -u)" -eq 0 ]]; then
  if [[ "$(id -u)" -eq 0 ]]; then
    chown root:root -- "$EXCHANGE_ROOT" || exchange_die "cannot chown '$EXCHANGE_ROOT' to root:root"
  fi
  chmod 1777 -- "$EXCHANGE_ROOT" || exchange_die "cannot set mode 1777 on '$EXCHANGE_ROOT'"
fi
if [[ ! -k "$EXCHANGE_ROOT" || ! -w "$EXCHANGE_ROOT" || ! -x "$EXCHANGE_ROOT" ]]; then
  _exchange_mode="$(stat -c %a -- "$EXCHANGE_ROOT")"
  _exchange_owner="$(stat -c %U -- "$EXCHANGE_ROOT")"
  exchange_die "exchange parent '$EXCHANGE_ROOT' is not a sticky world-accessible directory (mode ${_exchange_mode}, owner ${_exchange_owner}). Fix: sudo chown root:root '$EXCHANGE_ROOT' && sudo chmod 1777 '$EXCHANGE_ROOT'"
fi
_exchange_parent_uid="$(stat -c %u -- "$EXCHANGE_ROOT")"
if [[ "$_exchange_parent_uid" -ne 0 && "$_exchange_parent_uid" -ne "$(id -u)" ]]; then
  exchange_die "exchange parent '$EXCHANGE_ROOT' is owned by uid ${_exchange_parent_uid}, not root. That owner can replace other users' exchange directories. Fix: sudo chown root:root '$EXCHANGE_ROOT' && sudo chmod 1777 '$EXCHANGE_ROOT' (install the tmpfiles rule so reboot recreates it as root:root)"
fi

EXCHANGE_USER="$(id -un)"
if [[ "$EXCHANGE_USER" == "." || "$EXCHANGE_USER" == ".." || ! "$EXCHANGE_USER" =~ ^[A-Za-z0-9._][A-Za-z0-9._-]*$ ]]; then
  exchange_die "refusing unsafe username '$EXCHANGE_USER' for the exchange directory"
fi
USER_EXCHANGE="$EXCHANGE_ROOT/$EXCHANGE_USER"
if [[ -L "$USER_EXCHANGE" || ( -e "$USER_EXCHANGE" && ! -d "$USER_EXCHANGE" ) ]]; then
  exchange_die "exchange directory '$USER_EXCHANGE' exists and is not a real directory; refusing"
fi
if [[ ! -d "$USER_EXCHANGE" ]]; then
  mkdir -m 0700 -- "$USER_EXCHANGE" || true
fi
if [[ -L "$USER_EXCHANGE" || ! -d "$USER_EXCHANGE" || ! -O "$USER_EXCHANGE" ]]; then
  exchange_die "exchange directory '$USER_EXCHANGE' is not a directory owned by $EXCHANGE_USER; refusing"
fi
chmod 0700 -- "$USER_EXCHANGE" || exchange_die "cannot set mode 0700 on '$USER_EXCHANGE'"

# /tmp inside the sandbox is a fresh tmpfs, so the parent mountpoint does not
# exist there. Create it, then bind only this user's directory.
BWRAP_ARGS+=(--dir "$EXCHANGE_ROOT")
BWRAP_ARGS+=(--bind "$USER_EXCHANGE" "$USER_EXCHANGE")

# Nix store must be bound first (other paths are symlinks into it)
NIX_PATHS=(
  /nix/store
  /nix/var
)

for path in "${NIX_PATHS[@]}"; do
  if [[ -e "$path" ]]; then
    BWRAP_ARGS+=(--ro-bind "$path" "$path")
  fi
done

# Note: /etc/profiles and ~/.nix-profile are symlinks into /nix/store,
# they work automatically since both /etc and /nix/store are bound
SYSTEM_RO_PATHS=(
  /etc
  /bin
  /usr
  /run/current-system
  /run/wrappers
  /run/systemd/resolve
  /run/nscd
)

for path in "${SYSTEM_RO_PATHS[@]}"; do
  if [[ -e "$path" ]]; then
    BWRAP_ARGS+=(--ro-bind "$path" "$path")
  fi
done

# Caller-provided binds, emitted in the order they were given so a later bind
# overrides an earlier one covering the same path (bwrap mounts in argv order).
# RO paths filter out /nix/* as already bound.
for spec in "${BIND_SPECS[@]}"; do
  kind="${spec%%$'\t'*}"
  value="${spec#*$'\t'}"
  case "$kind" in
    ro)
      if [[ -e "$value" ]] && [[ "$value" != /nix/* ]]; then
        BWRAP_ARGS+=(--ro-bind "$value" "$value")
      fi
      ;;
    rw)
      if [[ -e "$value" ]]; then
        BWRAP_ARGS+=(--bind "$value" "$value")
      fi
      ;;
    *)
      IFS=',' read -r src dst <<< "$value"
      if [[ -e "$src" ]]; then
        BWRAP_ARGS+=("--$kind" "$src" "$dst")
      fi
      ;;
  esac
done

for env in "${ENVS[@]}"; do
  IFS='=' read -r name value <<< "$env"
  BWRAP_ARGS+=(--setenv "$name" "$value")
done

# --- Inherited tmux socket confinement (defects:D262, tasks:T1793) ----------
# yolo passes --confine-socket when it inherited a live host tmux socket. That
# socket must stay unreachable inside the sandbox no matter which bind would
# expose it: directly, through a lexical alias (symlink, '..', redundant
# spelling), through an exact hard link, or through a bind-mounted ancestor
# alias. Now that the complete bind set is concrete, every bind source is
# canonicalized and compared against the protected socket by path AND by
# filesystem object identity. An exact-socket source is omitted with a
# diagnostic; a bind covering the socket through an ancestor is preserved —
# harmless siblings keep their read-only/read-write/device semantics — while
# the projected socket destination is masked with /dev/null. Masks are appended
# after every other bind, and a final assertion proves that the last bind
# covering each projected socket is its own mask, so no later bind can
# re-expose it. Any resolution or identity failure refuses the launch.
if [[ -n "$CONFINE_SOCKET" ]]; then
  _confine_sock="$CONFINE_SOCKET"
  if [[ ! -S "$_confine_sock" ]]; then
    echo "llm-sandbox: confined tmux socket '$_confine_sock' is not a live socket; refusing launch" >&2
    exit 1
  fi
  if ! _confine_canon="$(realpath -- "$_confine_sock")"; then
    echo "llm-sandbox: cannot canonicalize confined tmux socket '$_confine_sock'; refusing launch" >&2
    exit 1
  fi

  # Same filesystem object (dev:inode) after dereferencing either spelling?
  _confine_same_object() {
    local a b
    a="$(stat -Lc '%d:%i' -- "$1" 2>/dev/null)" || return 1
    b="$(stat -Lc '%d:%i' -- "$2" 2>/dev/null)" || return 1
    [[ -n "$a" && -n "$b" && "$a" == "$b" ]]
  }

  # Prints the protected socket's path relative to $1 when $1 covers it —
  # lexically after canonicalization, or by object identity against any
  # ancestor (a bind-mounted alias has its own canonical path but shares the
  # ancestor's dev:inode). Returns 1 when $1 covers neither.
  _confine_relative_projection() {
    local csrc="$1" ancestor
    if [[ "$csrc" == "/" ]]; then
      printf '%s' "${_confine_canon#/}"
      return 0
    fi
    if [[ "$_confine_canon" == "$csrc"/* ]]; then
      printf '%s' "${_confine_canon#"$csrc"/}"
      return 0
    fi
    ancestor="$(dirname -- "$_confine_canon")"
    while [[ -n "$ancestor" && "$ancestor" != "/" ]]; do
      if _confine_same_object "$csrc" "$ancestor"; then
        printf '%s' "${_confine_canon#"$ancestor"/}"
        return 0
      fi
      ancestor="$(dirname -- "$ancestor")"
    done
    return 1
  }

  CONFINE_MASKS=()
  _confined_args=()
  _i=0
  while [[ $_i -lt ${#BWRAP_ARGS[@]} ]]; do
    _opt="${BWRAP_ARGS[$_i]}"
    case "$_opt" in
      --bind|--ro-bind|--dev-bind)
        _src="${BWRAP_ARGS[$((_i + 1))]}"
        _dst="${BWRAP_ARGS[$((_i + 2))]}"
        if ! _csrc="$(realpath -- "$_src")"; then
          echo "llm-sandbox: cannot canonicalize bind source '$_src'; refusing launch" >&2
          exit 1
        fi
        if [[ "$_csrc" == "$_confine_canon" ]] || _confine_same_object "$_csrc" "$_confine_canon"; then
          echo "llm-sandbox: omitting bind of confined tmux socket '$_src'" >&2
          _i=$((_i + 3))
          continue
        fi
        if _rel="$(_confine_relative_projection "$_csrc")" && [[ -n "$_rel" ]]; then
          # Project the socket through this covering bind to its sandbox-side
          # destination (lexical normalization only; the destination need not
          # exist on the host).
          _proj="$(realpath -ms -- "$_dst/$_rel")"
          _dup=0
          for _seen in "${CONFINE_MASKS[@]:-}"; do
            [[ "$_seen" == "$_proj" ]] && _dup=1
          done
          [[ $_dup -eq 0 ]] && CONFINE_MASKS+=("$_proj")
        fi
        _confined_args+=("$_opt" "$_src" "$_dst")
        _i=$((_i + 3))
        ;;
      *)
        _confined_args+=("$_opt")
        _i=$((_i + 1))
        ;;
    esac
  done

  # Masks go last so no later bind can re-expose a projected socket.
  for _proj in "${CONFINE_MASKS[@]:-}"; do
    [[ -n "$_proj" ]] || continue
    _confined_args+=(--ro-bind /dev/null "$_proj")
  done

  # Ordering assertion: the last bind whose destination is an ancestor-or-equal
  # of each projected socket must be that socket's own /dev/null mask.
  for _proj in "${CONFINE_MASKS[@]:-}"; do
    [[ -n "$_proj" ]] || continue
    _last_cover=""
    _i=0
    while [[ $_i -lt ${#_confined_args[@]} ]]; do
      _opt="${_confined_args[$_i]}"
      case "$_opt" in
        --bind|--ro-bind|--dev-bind)
          _ndst="$(realpath -ms -- "${_confined_args[$((_i + 2))]}")"
          if [[ "$_ndst" == "$_proj" || "$_proj" == "$_ndst"/* ]]; then
            _last_cover="$_opt|${_confined_args[$((_i + 1))]}|$_ndst"
          fi
          _i=$((_i + 3))
          ;;
        *)
          _i=$((_i + 1))
          ;;
      esac
    done
    if [[ "$_last_cover" != "--ro-bind|/dev/null|$_proj" ]]; then
      echo "llm-sandbox: final mount order would re-expose confined tmux socket at '$_proj'; refusing launch" >&2
      exit 1
    fi
  done

  BWRAP_ARGS=("${_confined_args[@]}")
fi

# After caller --env and after confinement rewrites BWRAP_ARGS, so this names
# the directory that was actually bound.
BWRAP_ARGS+=(--setenv SMIND_EXCHANGE_DIR "$USER_EXCHANGE")

PS4='+ ${EPOCHREALTIME} '
if [[ -z "${LLM_SANDBOX_NET_HELPER:-}" ]]; then
  set -x
  exec bwrap "${BWRAP_ARGS[@]}" "$@"
fi

# A network namespace of its own: bwrap reports the sandbox's PID on --info-fd
# and holds COMMAND on --block-fd until the helper has connected the namespace,
# so COMMAND never runs unconnected. --unshare-net overrides the --share-net
# above. The subshell keeps stdin and restores SIGINT/SIGQUIT, which an
# asynchronous command would otherwise lose and ignore (SIGINT/SIGQUIT stay
# ignored if this script was started with them ignored).
_net_fifos="$(mktemp -d)"
mkfifo "$_net_fifos/info" "$_net_fifos/block"
set -x
(
  trap - INT QUIT
  exec bwrap "${BWRAP_ARGS[@]}" --unshare-net --info-fd 3 --block-fd 4 "$@" \
    3>"$_net_fifos/info" 4<"$_net_fifos/block"
) <&0 &
{ set +x; } 2>/dev/null
_bwrap_pid=$!
exec 5<"$_net_fifos/info" 6>"$_net_fifos/block"
rm -r -- "$_net_fifos"
_sandbox_pid=""
# fd 5 stays open until this script exits: bwrap goes on writing the info
# after the child-pid, and a write into a fifo nobody reads kills it with
# SIGPIPE before it lets the sandbox start.
while IFS= read -r _info_line <&5; do
  if [[ "$_info_line" =~ \"child-pid\":\ *([0-9]+) ]]; then
    _sandbox_pid="${BASH_REMATCH[1]}"
    break
  fi
done
if [[ -z "$_sandbox_pid" ]]; then
  # bwrap exited before it started the sandbox, and said why.
  wait "$_bwrap_pid" || exit
  exit 1
fi
# A held sandbox does not die with bwrap, and an EOF on --block-fd releases
# it: whatever ends this script before the release kills it instead.
_sandbox_released=0
trap '(( _sandbox_released )) || kill -KILL "$_sandbox_pid" 2>/dev/null || true' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
if ! "$LLM_SANDBOX_NET_HELPER" "$_sandbox_pid"; then
  echo "llm-sandbox: $LLM_SANDBOX_NET_HELPER did not connect the sandbox's network" >&2
  exit 1
fi
printf x >&6
_sandbox_released=1
exec 6>&-
wait "$_bwrap_pid"
