#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SBT_LAUNCH_JAR:?set SBT_LAUNCH_JAR to the pinned sbt launcher (nix develop .#backend)}"
# scalac runs on sbt's own threads, whose stack is -Xss (JVM default 1 MiB). Typer and PostTyper over the deepest
# tree, the 56-generator for-comprehension in manure HttpSuite, need 0.8-1 MiB depending on JIT state: fresh sbt
# compiles overflowed at 768 KiB 4/4, at 896 KiB 2/10, fully interpreted at 992 KiB, and at the 1 MiB default
# intermittently under host load. 4 MiB is 4x that need.
compiler_stack=4m
exec java -Dsbt.supershell=false -Dsbt.ci=true "-Xss$compiler_stack" ${SBT_JAVA_OPTS:-} -jar "$SBT_LAUNCH_JAR" "$@"
