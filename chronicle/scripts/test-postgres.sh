#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${POSTGRES_HOME:?set POSTGRES_HOME to PostgreSQL18.6 plus pgvector0.8.7}"
# Suites run in groups, one forked test JVM and one database per group (CHRONICLE_TEST_GROUPS=1 is the serial fallback).
max_groups=16
# Each group keeps the connection budget the single shared database had (PostgreSQL default max_connections).
connections_per_group=100
if [[ -v CHRONICLE_TEST_GROUPS ]]; then
  groups=$CHRONICLE_TEST_GROUPS
else
  cores=${NIX_BUILD_CORES:-0}
  if (( cores == 0 )); then cores=$(nproc); fi
  groups=$(( cores < max_groups ? cores : max_groups ))
fi
if [[ ! "$groups" =~ ^[1-9][0-9]*$ ]]; then echo 'CHRONICLE_TEST_GROUPS must be a positive integer' >&2; exit 2; fi
base=$(mktemp -d "${TMPDIR:-/tmp}/chronicle-pg.XXXXXX")
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
trap '"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"' EXIT
printf '%s\n' chronicle-test-password > "$base/password"
chmod 600 "$base/password"
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 >"$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base -c max_connections=$(( groups * connections_per_group ))" -w start
# The template carries the extensions, so no two groups race on their first creation; Database.initialize() still
# applies the schema migrations inside every group database, as it does for the single database of a serial run.
{
  echo 'CREATE DATABASE chronicle_template;'
  echo '\connect chronicle_template'
  echo 'CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;'
  echo '\connect postgres'
  for (( i = 0; i < groups; i++ )); do echo "CREATE DATABASE chronicle_g$i TEMPLATE chronicle_template;"; done
} | PGPASSWORD=chronicle-test-password "$POSTGRES_HOME/bin/psql" -X -q -v ON_ERROR_STOP=1 -h "$base" -p "$port" -U postgres -d postgres
export CHRONICLE_TEST_GROUPS=$groups
export CHRONICLE_TEST_GROUP_JDBC_PREFIX="jdbc:postgresql://127.0.0.1:$port/chronicle_g"
# Every group JVM receives its own CHRONICLE_TEST_JDBC from the sbt grouping.
unset CHRONICLE_TEST_JDBC
export CHRONICLE_REQUIRE_POSTGRES=1
printf 'CHRONICLE FULL SUITE: %s test groups, one database each.\n' "$groups"
./scripts/sbt.sh 'Test / validationInventory' testFull
