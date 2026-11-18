#!/usr/bin/env bash
# Runs the two suites that exercise run.sh against fixture databases on one owned, throwaway PostgreSQL cluster:
#   chronicle.LegacyRetirementScriptsTest and haystack.storage.LegacyRetirementScriptsTest.
# Usage, from the repository root:  nix develop .#chronicle --command bash scripts/one-off/legacy-retirement/test.sh
# Optional argument: chronicle | haystack | drop (default: all; drop = test-drop-databases.sh, its own cluster).
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${POSTGRES_HOME:?run inside nix develop .#chronicle (PostgreSQL 18 with pgvector)}"
which=${1:-both}
case $which in chronicle|haystack|drop|both) ;; *) echo 'usage: test.sh [chronicle|haystack|drop]' >&2; exit 2 ;; esac
# Short private root: unix-socket paths are limited to 107 bytes.
base=$(mktemp -d /tmp/lr-test.XXXXXX)
stop() { "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"; }
trap stop EXIT
password=chronicle-test-password   # the fixed fixture password chronicle.Fixtures expects; not a secret
printf '%s\n' "$password" >"$base/password"; chmod 600 "$base/password"
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 >"$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base -c fsync=off -c synchronous_commit=off -c full_page_writes=off" -w start >/dev/null
PGPASSWORD=$password "$POSTGRES_HOME/bin/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$port" -U postgres -d postgres \
  -c 'CREATE DATABASE chronicle' -c 'CREATE DATABASE haystack_scala_test' -c '\connect chronicle' -c 'CREATE EXTENSION vector' -c 'CREATE EXTENSION pg_trgm'
export LEGACY_RETIREMENT_SCRIPTS=1   # the suites register their case only with this set
status=0
# A selection that ran no case must fail: sbt reports success for an empty testOnly.
suite() {
  local log=$base/$1.log expected=$2
  shift 2
  "$@" 2>&1 | tee "$log" || return 1
  grep -q "Passed: Total $expected, Failed 0, Errors 0, Passed $expected" "$log" || { echo "legacy-retirement test: expected exactly $expected passed cases" >&2; return 1; }
}
if [[ $which == chronicle || $which == both ]]; then
  CHRONICLE_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/chronicle" CHRONICLE_REQUIRE_POSTGRES=1 \
    suite chronicle 2 bash scripts/backend-sbt.sh 'chronicleServer/testOnly chronicle.LegacyRetirementScriptsTest' || status=1
fi
if [[ $which == haystack || $which == both ]]; then
  HAYSTACK_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/haystack_scala_test" HAYSTACK_TEST_DB_USER=postgres HAYSTACK_TEST_DB_PASSWORD_FILE="$base/password" \
    suite haystack 3 bash scripts/backend-sbt.sh 'haystackServer/testOnly haystack.storage.LegacyRetirementScriptsTest' || status=1
fi
if [[ $which == drop || $which == both ]]; then
  bash scripts/one-off/legacy-retirement/test-drop-databases.sh || status=1
fi
exit "$status"
