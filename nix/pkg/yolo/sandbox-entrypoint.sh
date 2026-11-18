#!/usr/bin/env bash
# Runs INSIDE the bubblewrap sandbox as the command entrypoint, when secret
# session variables and/or sandbox pre-start hooks are configured (see yolo.sh).
# It, in order:
#   1. loads the composed secrets file ($YOLO_SECRETS_FILE) — one NAME=VALUE
#      line per secret — into the env by exporting each line verbatim (the value
#      is taken literally, never re-parsed, so no quoting/escaping is required);
#   2. sources the composed sandbox pre-start hook script
#      ($YOLO_SANDBOX_HOOKS_FILE), so hooks run in this shell and any env they
#      set is inherited by the command;
#   3. exec's the real command (its arguments).
# Both files are bound read-only; their paths arrive via the env vars above.
# Either may be absent. The store path of this script is reachable in the
# sandbox via the ro-bound /nix/store.
#
# It prints nothing of its own unless $YOLO_SANDBOX_TRACE is 1 (yolo sets it for
# `yolo --trace` / YOLO_TRACE=1): then steps 2 and 3 are traced to stderr. The
# command never sees any of the three variables.
set -u

# Read before the secrets file is loaded, so no line of that file can set it.
_trace_steps="${YOLO_SANDBOX_TRACE:-}"

if [ -n "${YOLO_SECRETS_FILE:-}" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && export "$line"
  done < "$YOLO_SECRETS_FILE"
fi

# When asked to, trace the remaining steps (each top-level hook command and the
# final exec) to stderr, timestamped like llm-sandbox's `exec bwrap` line so slow
# startup steps stand out. Enabled only after the secrets loop so their values
# stay out of it.
if [ "$_trace_steps" = 1 ]; then
  PS4='+ ${EPOCHREALTIME} '
  set -x
fi

if [ -n "${YOLO_SANDBOX_HOOKS_FILE:-}" ]; then
  # shellcheck disable=SC1090
  . "$YOLO_SANDBOX_HOOKS_FILE"
fi

# These inputs (passed in via bwrap --env, so not cleared by the host-side
# unset of YOLO_*) have served their purpose; drop them so the agent's env
# carries no YOLO_* orchestration state. Untraced, so the startup trace (which
# lands in the agent's terminal) names no YOLO_* variables either.
{ set +x; } 2>/dev/null
unset YOLO_SECRETS_FILE YOLO_SANDBOX_HOOKS_FILE YOLO_SANDBOX_TRACE
if [ "$_trace_steps" = 1 ]; then
  set -x
fi

exec "$@"
