#!/usr/bin/env bash
set -euo pipefail
: "${HAYSTACK_SERVER_BINARY:?explicit built native executable path required; for JVM invoke java -jar target/haystack-server.jar directly}"
exec "$HAYSTACK_SERVER_BINARY" "$@"
