#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${POSTGRES_HOME:?use pinned nix develop .#chronicle}"
mkdir -p shared/service-runtime/target/validation-runs
report=$(mktemp -d "$PWD/shared/service-runtime/target/validation-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
if [[ -d shared/service-runtime/target/test-reports ]]; then
  mv shared/service-runtime/target/test-reports "$report/previous-test-reports"
fi
echo "Runtime test report: $report"
base=$(mktemp -d "${TMPDIR:-/tmp}/service-runtime-pg.XXXXXX")
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
trap '"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"' EXIT
# Owned disposable cluster with password auth exercises the credential-file boundary.
printf '%s\n' runtime-test-password > "$base/password"
chmod 600 "$base/password"
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start
export RUNTIME_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/postgres"
# No test filters/no database skips. Serial PostgreSQL suite execution in build.sbt.
status=0
bash scripts/backend-sbt.sh 'serviceRuntime/testFull' 2>&1 | tee "$report/run.log" || status=$?
python3 scripts/junit-gate.py --counts "$report/counts.json" shared/service-runtime/target/test-reports || status=1
exit "$status"
