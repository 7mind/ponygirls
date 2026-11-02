#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SBT_LAUNCH_JAR:?set SBT_LAUNCH_JAR to the pinned sbt launcher (nix develop .#backend)}"
exec java -Dsbt.supershell=false -Dsbt.ci=true ${SBT_JAVA_OPTS:-} -jar "$SBT_LAUNCH_JAR" "$@"
