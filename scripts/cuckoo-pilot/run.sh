#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 2 ]]; then
  printf 'Usage: bash run.sh feasibility|scored OUTPUT_DIR\n' >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec timeout --signal=TERM --kill-after=10s 3650s node "$script_dir/pilot.mjs" "$1" "$2"
