#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Usage: test-target.sh jvm [core|full]
#        test-target.sh native /absolute/server /absolute/build-source-manifest [core|full]
# core is an explicit iterative diagnostic, NEVER full release acceptance.
: "${POSTGRES_HOME:?use pinned nix develop .#chronicle}"
mode=${1:?jvm or native}; shift
# Never inherit operator/agent live-service settings into disposable verification.
unset MANURE_URL MANURE_URL_FILE MANURE_TOKEN MANURE_TOKEN_FILE MANURE_CACHE_DIR MANURE_ALLOW_INSECURE_HTTP
mkdir -p manure/backend/target/target-runs
report=$(mktemp -d "$PWD/manure/backend/target/target-runs/$(date -u +%Y%m%dT%H%M%SZ)-$mode.XXXXXX")
python3 manure/scripts/artifact-source.py > "$report/artifact-source.sha256"
case "$mode" in
 jvm)
  scope=${1:-full}
  : "${JAVA_HOME:?pinned JDK required}"
  bash scripts/backend-sbt.sh 'manureServer/assembly' > "$report/build.log" 2>&1
  artifact="$PWD/manure/backend/target/manure-server.jar"
  export MANURE_TEST_SERVER_COMMAND_JSON="$(python3 -c 'import json,sys;print(json.dumps([sys.argv[1],"--enable-native-access=ALL-UNNAMED","-jar",sys.argv[2]]))' "$JAVA_HOME/bin/java" "$artifact")"
  ;;
 native)
  artifact=${1:?absolute native ELF}; built_manifest=${2:?actual native build source manifest}; scope=${3:-full}
  [[ $artifact = /* && -x $artifact && $built_manifest = /* && -f $built_manifest ]] || { echo 'explicit native artifact/source binding required' >&2; exit 1; }
  cmp "$built_manifest" "$report/artifact-source.sha256"
  cp "$built_manifest" "$report/native-build-source.sha256"
  export MANURE_TEST_SERVER_COMMAND_JSON="$(python3 -c 'import json,sys;print(json.dumps([sys.argv[1]]))' "$artifact")"
  unset MANURE_POSIX_LIBRARY
  file "$artifact" | tee "$report/artifact-file.txt"
  ;;
 *) echo 'jvm or native required' >&2; exit 1 ;;
esac
[[ $scope = core || $scope = full ]] || exit 1
if [[ $scope == full ]]; then
 : "${MANURE_PLAYWRIGHT_CORE_PATH:?full target run requires pinned playwright-core}"
 : "${MANURE_CHROMIUM_BIN:?full target run requires pinned Chromium}"
 command -v node >/dev/null
 command -v openssl >/dev/null
fi
sha256sum "$artifact" > "$report/artifact.sha256"
git rev-parse HEAD > "$report/git-head"
"$POSTGRES_HOME/bin/postgres" --version > "$report/postgres-version"
find manure/tests manure/manure manure/web manure/models/fixtures -type f \( -name '*.py' -o -name '*.js' -o -name '*.mjs' -o -name '*.json' -o -name '*.html' -o -name '*.css' \) ! -path '*/__pycache__/*' -print0 | sort -z | xargs -0 sha256sum > "$report/test-inputs.sha256"
base=$(mktemp -d "${TMPDIR:-/tmp}/manure-target-pg.XXXXXXXX")
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
trap '"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"' EXIT
printf '%s\n' manure-target-disposable-password > "$base/password"; chmod 600 "$base/password"
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start
export PATH="$POSTGRES_HOME/bin:$PATH"
export MANURE_TEST_JDBC_URL="jdbc:postgresql://127.0.0.1:$port/postgres" MANURE_TEST_JDBC_USER=postgres MANURE_TEST_JDBC_PASSWORD_FILE="$base/password" MANURE_TEST_ALLOW_CREATEDB=1
export PYTHONPATH="$PWD/manure:$PWD/manure/tests${PYTHONPATH:+:$PYTHONPATH}"
if [[ $mode == jvm ]]; then
 cc -std=c11 -Wall -Wextra -Werror -Wconversion -Wsign-conversion -Wshadow -Wformat=2 -Wstrict-prototypes -Wmissing-prototypes -fPIC -shared \
  -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/linux" manure/server/src/main/c/posix_native.c -o "$base/libmanure_posix.so"
 export MANURE_POSIX_LIBRARY="$base/libmanure_posix.so"
fi
set +e
# Finite whole-suite deadline, in addition to fixture/readiness/body/DB/browser bounds.
timeout 1800 python3 manure/scripts/target-suite.py --scope "$scope" --report "$report" 2>&1 | tee "$report/run.log"
status=${PIPESTATUS[0]}
set -e
printf '%s\n' "$status" > "$report/exit-status"
cp "$base/server.log" "$report/postgres-server.log"
echo "Manure $mode $scope target receipt: $report"
exit "$status"
