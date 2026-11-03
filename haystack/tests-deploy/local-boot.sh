#!/usr/bin/env bash
# Full disposable native HTTP/MCP/WS/restart/provider gate, not a health smoke.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${1:?usage: local-boot.sh /absolute/nix-package-output}"
export HAYSTACK_SERVER_COMMAND="$1/bin/haystack-server"
export HAYSTACK_SERVER_ARTIFACT_FILE="${HAYSTACK_SERVER_ARTIFACT_FILE:-$1/libexec/haystack-server}"
export HAYSTACK_ARTIFACT_KIND=native
exec bash haystack/scripts/test-current.sh
