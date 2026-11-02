#!/usr/bin/env bash
set -euo pipefail
# Behavioral-Active / Blackbox / Good-Communication: real Linux JNI on owned temp data.
# JAVA_HOME must identify the pinned development JDK; no dependency downloads.
: "${JAVA_HOME:?set JAVA_HOME to the pinned development JDK}"
root=$(cd "$(dirname "$0")/../../.." && pwd)
out=$(mktemp -d "${TMPDIR:-/tmp}/manure-native-test.XXXXXXXX")
trap 'rm -rf "$out"' EXIT
cc=${CC:-cc}
flags=(-std=c11 -Wall -Wextra -Werror -Wconversion -Wsign-conversion -Wshadow
       -Wformat=2 -Wstrict-prototypes -Wmissing-prototypes -g -fno-omit-frame-pointer)
if [[ -n ${SANITIZE:-} ]]; then
  flags+=("-fsanitize=$SANITIZE")
  # The pinned JVM's loader need not search the host compiler's runtime directory.
  runtime=$(readlink -f "$("$cc" -print-file-name=libubsan.so)")
  flags+=("-Wl,-rpath,$(dirname "$runtime")")
fi
mkdir -p "$out/classes" "$out/headers"
"$JAVA_HOME/bin/javac" -Xlint:all -Werror -h "$out/headers" -d "$out/classes" \
  "$root/manure/server/src/main/java/manure/storage/NativeFailure.java" \
  "$root/manure/server/src/main/java/manure/storage/PosixNative.java" \
  "$root/manure/server/native-tests/NativeSelfTest.java"
cmp "$out/headers/manure_storage_PosixNative.h" \
    "$root/manure/server/src/main/c/manure_storage_PosixNative.h"
"$cc" "${flags[@]}" -fPIC -shared -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/linux" \
  "$root/manure/server/src/main/c/posix_native.c" -o "$out/libmanure_posix.so"
java_env=()
if [[ ${SANITIZE:-} == *address* ]]; then
  # Scope preload to the JVM, not timeout/cleanup or host-tool subprocesses.
  java_env+=("LD_PRELOAD=$("$cc" -print-file-name=libasan.so)${LD_PRELOAD:+:$LD_PRELOAD}")
  # JVM owns process-lifetime allocations; this run detects invalid access, not JVM leaks.
  java_env+=("ASAN_OPTIONS=detect_leaks=0:handle_segv=0${ASAN_OPTIONS:+:$ASAN_OPTIONS}")
fi
export UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1${UBSAN_OPTIONS:+:$UBSAN_OPTIONS}"
timeout 90 env "${java_env[@]}" "$JAVA_HOME/bin/java" --enable-native-access=ALL-UNNAMED -Xcheck:jni \
  -cp "$out/classes" manure.storage.NativeSelfTest --shared "$out/libmanure_posix.so"
