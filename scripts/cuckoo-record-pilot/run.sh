#!/usr/bin/env bash
# One cell of the pilot. Usage: run.sh LABEL EXTENSION_DIR OUTPUT_DIR REPS MODEL THINKING CELL
# Needs PI_SDK_ROOT (the pi-monorepo directory of the pinned Pi) and GATEWAY_EXTENSION (the gateway's index.ts).
# DRY=1 stops every request before it is sent and only checks its shape.
set -euo pipefail
if [[ $# != 7 ]]; then
  printf 'Usage: run.sh LABEL EXTENSION_DIR OUTPUT_DIR REPS MODEL THINKING CELL\n' >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec timeout --signal=TERM --kill-after=15s 3600s node "$script_dir/pilot.mjs" "$@"
