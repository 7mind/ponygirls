#!/usr/bin/env bash
# Development entry point for the Rites run supervisor. Resolves the pinned
# Node, bubblewrap and toolchain from the current Nix environment and execs
# the supervisor so signals reach it directly. The Nix package provides the
# same interface as bin/rites-worker with store-pinned paths.
#
# Usage: run-worker.sh WORKSPACE MODEL_CONFIG TIMEOUT_SECONDS
set -euo pipefail

usage() {
  echo "usage: run-worker.sh WORKSPACE MODEL_CONFIG TIMEOUT_SECONDS" >&2
  exit 1
}

[ $# -eq 3 ] || usage

RITES_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_RUNTIME="${RITES_WORKER_RUNTIME:-$RITES_DIR/target/worker}"
resolve_bin() {
  command -v "$1" >/dev/null 2>&1 || { echo "run-worker: required command not found: $1" >&2; exit 1; }
  readlink -f "$(command -v "$1")"
}

toolchain_dir() {
  local bin
  bin="$(resolve_bin "$1")"
  dirname "$bin"
}

export RITES_NODE="${RITES_NODE:-$(resolve_bin node)}"
export RITES_BWRAP="${RITES_BWRAP:-$(resolve_bin bwrap)}"
# The sandbox binds RITES_WORKER_RUNTIME at /rites-worker; the supervisor
# itself always runs from the real build tree.
export RITES_WORKER_RUNTIME="$(readlink -f "$WORKER_RUNTIME")"
export RITES_NIX_STORE="${RITES_NIX_STORE:-/nix/store}"
if [ -z "${RITES_TOOLCHAIN_PATH:-}" ]; then
  RITES_TOOLCHAIN_PATH="$(toolchain_dir node):$(toolchain_dir bash):$(toolchain_dir git):$(toolchain_dir rg):$(toolchain_dir fd):$(toolchain_dir ls):$(toolchain_dir grep):$(toolchain_dir find)"
  export RITES_TOOLCHAIN_PATH
fi

SUPERVISOR="${RITES_SUPERVISOR:-$RITES_DIR/target/worker/worker/supervisor.js}"
[ -f "$SUPERVISOR" ] || { echo "run-worker: supervisor not built: $SUPERVISOR (npm run build)" >&2; exit 1; }

exec "$RITES_NODE" "$SUPERVISOR" "$@"
