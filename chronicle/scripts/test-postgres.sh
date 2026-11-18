#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${POSTGRES_HOME:?set POSTGRES_HOME to PostgreSQL18.6 plus pgvector0.8.7}"
# Suites run in groups, one forked test JVM and one owned PostgreSQL cluster per group
# (CHRONICLE_TEST_GROUPS=1 is the serial fallback).
max_groups=16
if [[ -v CHRONICLE_TEST_GROUPS ]]; then
  groups=$CHRONICLE_TEST_GROUPS
else
  cores=${NIX_BUILD_CORES:-0}
  if (( cores == 0 )); then cores=$(nproc); fi
  groups=$(( cores < max_groups ? cores : max_groups ))
fi
if [[ ! "$groups" =~ ^[1-9][0-9]*$ ]]; then echo 'CHRONICLE_TEST_GROUPS must be a positive integer' >&2; exit 2; fi
base=$(mktemp -d "${TMPDIR:-/tmp}/chronicle-pg.XXXXXX")
stop_clusters() {
  for data in "$base"/data*; do "$POSTGRES_HOME/bin/pg_ctl" -D "$data" -m immediate -w stop >/dev/null 2>&1 || true; done
  rm -rf "$base"
}
trap stop_clusters EXIT
read -r -a ports <<<"$(python3 -c 'import socket,sys
s=[socket.socket() for _ in range(int(sys.argv[1]))]
for x in s: x.bind(("127.0.0.1",0))
print(" ".join(str(x.getsockname()[1]) for x in s))' "$groups")"
printf '%s\n' chronicle-test-password > "$base/password"
chmod 600 "$base/password"
# Template cluster: database chronicle with the extensions; Database.initialize() applies the schema migrations in
# every group, as it does for the single database of a serial run. Each group gets a copy of the stopped template.
# The clusters are discarded on exit, so they skip crash durability ("Non-Durable Settings" in the PostgreSQL manual),
# and the fixture superuser's SCRAM verifier uses one PBKDF2 iteration: suites open a connection per transaction
# (IndexedSearchTest about 3,700 in its first case), and both costs otherwise sit on its 2-minute deadline.
non_durable='-c fsync=off -c synchronous_commit=off -c full_page_writes=off'
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 >"$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/template.log" -o "-c listen_addresses= -k $base -p ${ports[0]}" -w start >/dev/null
PGPASSWORD=chronicle-test-password "$POSTGRES_HOME/bin/psql" -X -q -v ON_ERROR_STOP=1 -h "$base" -p "${ports[0]}" -U postgres -d postgres \
  -c 'SET scram_iterations = 1' -c "ALTER ROLE postgres PASSWORD 'chronicle-test-password'" \
  -c 'CREATE DATABASE chronicle' -c '\connect chronicle' -c 'CREATE EXTENSION vector' -c 'CREATE EXTENSION pg_trgm'
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m fast -w stop >/dev/null
urls=()
for (( i = 0; i < groups; i++ )); do
  cp -a "$base/data" "$base/data$i"
  "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data$i" -l "$base/server$i.log" -o "-h 127.0.0.1 -p ${ports[i]} -k $base $non_durable" -w start >/dev/null
  urls+=("jdbc:postgresql://127.0.0.1:${ports[i]}/chronicle")
done
export CHRONICLE_TEST_GROUP_JDBC="${urls[*]}"
# Every group JVM receives its own CHRONICLE_TEST_JDBC from the sbt grouping.
unset CHRONICLE_TEST_JDBC
export CHRONICLE_REQUIRE_POSTGRES=1
printf 'CHRONICLE FULL SUITE: %s test groups, one PostgreSQL cluster each.\n' "$groups"
./scripts/sbt.sh 'Test / validationInventory' testFull
