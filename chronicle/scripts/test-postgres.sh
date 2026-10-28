#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${POSTGRES_HOME:?set POSTGRES_HOME to PostgreSQL18.6 plus pgvector0.8.7}"
base=$(mktemp -d "${TMPDIR:-/tmp}/chronicle-pg.XXXXXX")
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
trap '"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"' EXIT
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A trust --no-locale --encoding=UTF8 >"$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start
export CHRONICLE_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/postgres"
export CHRONICLE_REQUIRE_POSTGRES=1
./scripts/sbt.sh 'Test / validationInventory' test
