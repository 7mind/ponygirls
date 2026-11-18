#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${POSTGRES_HOME:?use pinned nix develop .#chronicle}"
: "${JAVA_HOME:?pinned JDK required}"
mkdir -p manure/backend/target/validation-runs
report=$(mktemp -d "$PWD/manure/backend/target/validation-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
for p in manure/backend/target/test-reports manure/server/target/test-reports; do
  if [[ -e $p ]]; then mv "$p" "$report/previous-$(basename "$(dirname "$p")")-$(basename "$p")"; fi
done
# Suites run in groups, one forked test JVM and one owned PostgreSQL cluster per group
# (MANURE_TEST_GROUPS=1 is the serial fallback).
max_groups=16
if [[ -v MANURE_TEST_GROUPS ]]; then
  groups=$MANURE_TEST_GROUPS
else
  cores=${NIX_BUILD_CORES:-0}
  if (( cores == 0 )); then cores=$(nproc); fi
  groups=$(( cores < max_groups ? cores : max_groups ))
fi
if [[ ! "$groups" =~ ^[1-9][0-9]*$ ]]; then echo 'MANURE_TEST_GROUPS must be a positive integer' >&2; exit 2; fi
base=$(mktemp -d "${TMPDIR:-/tmp}/manure-backend-pg.XXXXXXXX")
starts=()
stop_clusters() {
  for start in "${starts[@]}"; do wait "$start" 2>/dev/null || true; done
  for data in "$base"/data*; do "$POSTGRES_HOME/bin/pg_ctl" -D "$data" -m immediate -w stop >/dev/null 2>&1 || true; done
  rm -rf "$base"
}
trap stop_clusters EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
read -r -a ports <<<"$(python3 -c 'import socket,sys
s=[socket.socket() for _ in range(int(sys.argv[1]))]
for x in s: x.bind(("127.0.0.1",0))
print(" ".join(str(x.getsockname()[1]) for x in s))' "$groups")"
printf '%s\n' manure-test-password > "$base/password"
chmod 600 "$base/password"
# One initdb, copied per group. The clusters are discarded on exit, so they skip crash durability ("Non-Durable Settings"
# in the PostgreSQL manual); scram_iterations=1 keeps the verifiers of the per-case runtime roles cheap.
fixture_settings='-c fsync=off -c synchronous_commit=off -c full_page_writes=off -c scram_iterations=1'
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$base/init.log"
urls=()
for (( i = 0; i < groups; i++ )); do
  (
    cp -a "$base/data" "$base/data$i"
    "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data$i" -l "$base/server$i.log" -o "-h 127.0.0.1 -p ${ports[i]} -k $base $fixture_settings" -w start >/dev/null
  ) &
  starts+=($!)
  urls+=("jdbc:postgresql://127.0.0.1:${ports[i]}/postgres")
done
startup_failed=0
for start in "${starts[@]}"; do wait "$start" || startup_failed=1; done
if (( startup_failed )); then echo 'PostgreSQL cluster startup failed' >&2; exit 1; fi
# Every group JVM receives its own MANURE_TEST_JDBC_URL from the sbt grouping.
export MANURE_TEST_GROUP_JDBC="${urls[*]}"
unset MANURE_TEST_JDBC_URL
export MANURE_TEST_JDBC_USER=postgres MANURE_TEST_JDBC_PASSWORD_FILE="$base/password" MANURE_TEST_ALLOW_CREATEDB=1
export MANURE_SOURCE_ROOT="$PWD"
cc -std=c11 -Wall -Wextra -Werror -Wconversion -Wsign-conversion -Wshadow -Wformat=2 -Wstrict-prototypes -Wmissing-prototypes -fPIC -shared \
 -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/linux" manure/server/src/main/c/posix_native.c -o "$base/libmanure_posix.so"
export MANURE_POSIX_LIBRARY="$base/libmanure_posix.so"
cmp manure/migration/schema.sql manure/backend/src/main/resources/manure-schema.sql
status=0
bash scripts/backend-sbt.sh 'manureStorage/testFull' 'manureServer/testFull' 'manureServer/assembly' 2>&1 | tee "$report/run.log" || status=$?
python3 scripts/junit-gate.py --counts "$report/counts.json" manure/server/target/test-reports manure/backend/target/test-reports || status=1
echo "Manure JVM test report: $report"
exit "$status"
