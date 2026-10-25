#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SBT_LAUNCH_JAR:?set SBT_LAUNCH_JAR to sbt 1.13.0 launcher}"
exec java -Dsbt.supershell=false -Dsbt.ci=true ${SBT_JAVA_OPTS:-} -jar "$SBT_LAUNCH_JAR" "$@"
