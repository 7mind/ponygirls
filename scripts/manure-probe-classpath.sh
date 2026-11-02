#!/usr/bin/env bash
# Compile offline when SBT_JAVA_OPTS points at the common Nix dependency cache.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# != 1 ]]; then echo "usage: $0 <output-classpath-file>" >&2; exit 2; fi
log=$(mktemp)
trap 'rm -f "$log"' EXIT
bash scripts/backend-sbt.sh --error 'manureStorage / Test / compile' \
  'export manureStorage / Test / fullClasspath' | tee "$log"
python3 - "$log" "$1" <<'PY'
from pathlib import Path
import sys
lines = [line for line in Path(sys.argv[1]).read_text().splitlines() if line.startswith('/')]
if len(lines) != 1 or any(not Path(part).exists() for part in lines[0].split(':')):
    raise SystemExit('expected exactly one existing absolute sbt Test classpath')
Path(sys.argv[2]).write_text(lines[0] + '\n')
PY
