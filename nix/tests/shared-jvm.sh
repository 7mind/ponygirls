#!/usr/bin/env bash
# Full suites of the six shared JVM modules: one sbt process, modules in sequence, one owned PostgreSQL cluster with a
# database per module. Run from the repository root with POSTGRES_HOME (nix develop .#chronicle).
set -euo pipefail
: "${POSTGRES_HOME:?set POSTGRES_HOME to PostgreSQL with pgvector (nix develop .#chronicle)}"
base=$(mktemp -d "${TMPDIR:-/tmp}/shared-jvm-pg.XXXXXX")
trap '"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"' EXIT
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
# Credentials fixed by the suites: serviceRuntime postgres/runtime-test-password and serviceAuth
# account_test/synthetic-test-password over SCRAM; retrievalPostgres postgres without a password (trust, its database only).
printf '%s\n' runtime-test-password > "$base/password"
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$base/init.log"
cat > "$base/data/pg_hba.conf" <<'HBA'
local all all scram-sha-256
host retrieval postgres 127.0.0.1/32 trust
host all all 127.0.0.1/32 scram-sha-256
HBA
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start >/dev/null
PGPASSWORD=runtime-test-password "$POSTGRES_HOME/bin/psql" -X -q -v ON_ERROR_STOP=1 -h "$base" -p "$port" -U postgres -d postgres \
  -c "CREATE ROLE account_test LOGIN SUPERUSER PASSWORD 'synthetic-test-password'" \
  -c 'CREATE DATABASE runtime' -c 'CREATE DATABASE accounts OWNER account_test' -c 'CREATE DATABASE retrieval'
export RUNTIME_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/runtime"
export ACCOUNT_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/accounts" ACCOUNT_REQUIRE_POSTGRES=1
export CHRONICLE_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/retrieval"
bash scripts/backend-sbt.sh losslessJson/testFull serviceRuntime/testFull serviceAuth/testFull modelHttp/testFull \
  retrievalCore/testFull retrievalPostgres/testFull
