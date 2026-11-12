#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 2 ]]; then
  printf 'Usage: bash run.sh OUTPUT development|scored\n' >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec timeout --signal=TERM --kill-after=15s 3660s node "$script_dir/pilot.mjs" run "$1" "$2"
