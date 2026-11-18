#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${POSTGRES_HOME:?use pinned nix develop .#backend}"
mkdir -p shared/service-auth/target/validation-runs
report=$(mktemp -d "$PWD/shared/service-auth/target/validation-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
if [[ -d shared/service-auth/target/test-reports ]]; then
  mv shared/service-auth/target/test-reports "$report/previous-test-reports"
fi
base=$(mktemp -d "${TMPDIR:-/tmp}/service-auth-pg.XXXXXX")
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
cleanup() {
  "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop > "$report/stop.log" 2>&1 || true
  rm -rf "$base"
}
trap cleanup EXIT
printf '%s\n' synthetic-test-password > "$base/password"
chmod 600 "$base/password"
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U account_test -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$report/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$report/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start
export ACCOUNT_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/postgres"
export ACCOUNT_REQUIRE_POSTGRES=1
printf 'Shared account test report: %s\n' "$report"
status=0
bash scripts/backend-sbt.sh 'serviceAuth/testFull' 2>&1 | tee "$report/run.log" || status=$?
python3 scripts/junit-gate.py --counts "$report/counts.json" shared/service-auth/target/test-reports || status=1
exit "$status"
