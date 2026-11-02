#!/usr/bin/env bash
# Build-only linkage; the production Java sources depend only on the JDK.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:?pinned Graal JAVA_HOME required}"
: "${MANURE_POSIX_STATIC:?directory containing musl libmanure_posix.a required}"
if [[ $# != 2 ]]; then echo "usage: $0 <test-classpath> <absolute-output>" >&2; exit 2; fi
classpath=$1
output=$2
[[ $output = /* && -f $MANURE_POSIX_STATIC/libmanure_posix.a ]]
# Fail closed on the private SVM ABI pin. No dependency download or runtime fallback.
grep -q 'GRAALVM_VERSION="25.4.4.1.1"' "$JAVA_HOME/release" || {
  echo 'POSIX hosted feature requires verified Graal CE 25.4.4.1.1' >&2; exit 1;
}
feature=$(mktemp -d)
trap 'rm -rf "$feature"' EXIT
javac --add-modules org.graalvm.nativeimage -cp "$JAVA_HOME/lib/svm/builder/*" \
  -d "$feature" manure/server/native-image/PosixLinkFeature.java
native-image -J-Xmx"${MANURE_NATIVE_IMAGE_HEAP:-6g}" --parallelism="${MANURE_NATIVE_IMAGE_THREADS:-4}" \
  --static --libc=musl -march=compatibility --enable-native-access=ALL-UNNAMED \
  -J--add-exports=org.graalvm.nativeimage.builder/com.oracle.svm.core.jdk=ALL-UNNAMED \
  -J--add-exports=org.graalvm.nativeimage.builder/com.oracle.svm.hosted.c=ALL-UNNAMED \
  --features=manure.build.PosixLinkFeature -H:CLibraryPath="$MANURE_POSIX_STATIC" \
  -cp "$classpath:$feature" manure.storage.FilesystemCapabilityProbe "$output"
