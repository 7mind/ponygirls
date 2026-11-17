#!/usr/bin/env bash
# Manure UI capture harness entry point. Run INSIDE the pinned chronicle shell:
#   nix develop .#chronicle --command bash manure/web/ui-capture/run.sh /abs/output/dir [capture.py options]
# Starts a private PostgreSQL cluster + the JVM Manure server on ephemeral ports,
# seeds synthetic data, drives pinned Chromium via playwright-core, writes PNGs.
# NOT wired into any build, check or test run.
set -euo pipefail
cd "$(dirname "$0")/../../.."
[[ $# -ge 1 && $1 = /* ]] || { echo 'usage: run.sh /absolute/output/dir [--count N] [--scenes a,b] [--timeout S]' >&2; exit 2; }
: "${POSTGRES_HOME:?run inside nix develop .#chronicle}"
: "${JAVA_HOME:?run inside nix develop .#chronicle}"
unset MANURE_URL MANURE_URL_FILE MANURE_TOKEN MANURE_TOKEN_FILE MANURE_CACHE_DIR MANURE_ALLOW_INSECURE_HTTP

# 1. pinned browser tooling (same descriptor the acceptance runner uses)
tools=${MANURE_ACCEPTANCE_TOOLS_JSON:-$PWD/manure/scripts/acceptance-tools-x86_64-linux.json}
eval "$(python3 - "$tools" <<'PY'
import json,shlex,sys
value=json.load(open(sys.argv[1]))
for key in ('MANURE_PLAYWRIGHT_CORE_PATH','MANURE_CHROMIUM_BIN','FONTCONFIG_FILE'):
    print('export %s=%s' % (key, shlex.quote(value[key])))
PY
)"

# 2. server jar (JVM assembly), built once unless an explicit jar is given
jar=${MANURE_UI_CAPTURE_SERVER_JAR:-$PWD/manure/backend/target/manure-server.jar}
if [[ ! -f $jar ]]; then
  echo "[run.sh] building $jar (sbt manureServer/assembly)"
  bash scripts/backend-sbt.sh 'manureServer/assembly'
fi
export MANURE_TEST_SERVER_COMMAND_JSON="$(python3 -c 'import json,sys;print(json.dumps([sys.argv[1],"--enable-native-access=ALL-UNNAMED","-jar",sys.argv[2]]))' "$JAVA_HOME/bin/java" "$jar")"

# 3. viewer assets: pinned nix build of the viewer package unless given
if [[ -z ${MANURE_TEST_VIEWER_DIR:-} ]]; then
  viewer=$(nix build --impure --no-link --print-out-paths --expr 'let f = builtins.getFlake (toString ./.); pkgs = import f.inputs.nixpkgs { system = builtins.currentSystem; }; in pkgs.callPackage ./nix/pkg/manure/viewer.nix {}')
  export MANURE_TEST_VIEWER_DIR="$viewer/share/manure/web/viewer"
fi

# 4. private PostgreSQL cluster (disposable, loopback only), as test-target.sh does for non-release runs
base=$(mktemp -d "${TMPDIR:-/tmp}/manure-ui-capture.XXXXXXXX")
cleanup() {
  "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$base"
}
trap cleanup EXIT
export PATH="$POSTGRES_HOME/bin:$PATH"
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
printf '%s\n' manure-ui-capture-disposable-password > "$base/password"; chmod 600 "$base/password"
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start > /dev/null
export MANURE_TEST_JDBC_URL="jdbc:postgresql://127.0.0.1:$port/postgres" MANURE_TEST_JDBC_USER=postgres \
       MANURE_TEST_JDBC_PASSWORD_FILE="$base/password" MANURE_TEST_ALLOW_CREATEDB=1

# 5. POSIX helper library for the JVM server
cc -std=c11 -fPIC -shared -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/linux" manure/server/src/main/c/posix_native.c -o "$base/libmanure_posix.so"
export MANURE_POSIX_LIBRARY="$base/libmanure_posix.so"

export PYTHONPATH="$PWD/manure:$PWD/manure/tests:$PWD/manure/web/ui-capture${PYTHONPATH:+:$PYTHONPATH}"
echo "[run.sh] uptime load: $(cut -d' ' -f1-3 /proc/loadavg)"
python3 manure/web/ui-capture/capture.py "$@"
