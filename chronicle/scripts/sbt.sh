#!/usr/bin/env bash
set -euo pipefail
# Keep Chronicle commands scoped even though the only build now lives at root.
exec "$(dirname "$0")/../../scripts/backend-sbt.sh" 'project chronicleServer' "$@"
