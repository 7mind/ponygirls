#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${GRAALVM_HOME:?set GRAALVM_HOME to the pinned GraalVM25.4.4.1.1}"
./scripts/sbt.sh assembly
mkdir -p target/native
read -r -a extra_flags <<< "${CHRONICLE_NATIVE_IMAGE_FLAGS:-}"
"$GRAALVM_HOME/bin/native-image" --no-fallback --enable-url-protocols=http,https "${extra_flags[@]}" \
  -H:+ReportExceptionStackTraces -jar target/chronicle-server.jar target/native/chronicle-server
# No JVM shim or fallback artifact is accepted.
test -x target/native/chronicle-server
