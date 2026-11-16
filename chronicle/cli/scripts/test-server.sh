#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CHRONICLE_SERVER:?set CHRONICLE_SERVER to a source-bound real executable}"
: "${PONYGIRLS_OWNED_FIXTURE_ROOT:?run via the owned with-service-postgres wrapper}"
npm run build
exec python3 scripts/test-server.py
