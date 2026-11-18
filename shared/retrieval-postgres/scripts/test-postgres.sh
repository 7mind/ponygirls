#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${POSTGRES_HOME:?use pinned nix develop .#chronicle}"
mkdir -p shared/retrieval-postgres/target/validation-runs
report=$(mktemp -d "$PWD/shared/retrieval-postgres/target/validation-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
for module in retrieval-core model-http retrieval-postgres; do
  mkdir -p "$report/$module"
  if [[ -d shared/$module/target/test-reports ]]; then mv "shared/$module/target/test-reports" "$report/$module/previous-test-reports"; fi
done
echo "Retrieval test report: $report"
base=$(mktemp -d "${TMPDIR:-/tmp}/retrieval-pg.XXXXXX")
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
trap '"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"' EXIT
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A trust --no-locale --encoding=UTF8 > "$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start
export CHRONICLE_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/postgres"
status=0
bash scripts/backend-sbt.sh 'retrievalCore/testFull' 'modelHttp/testFull' 'retrievalPostgres/testFull' 2>&1 | tee "$report/run.log" || status=$?
python3 scripts/junit-gate.py --counts "$report/counts.json" \
  shared/retrieval-core/target/test-reports shared/model-http/target/test-reports shared/retrieval-postgres/target/test-reports || status=1
exit "$status"
