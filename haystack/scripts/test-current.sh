#!/usr/bin/env bash
# Executable transport suite (tests-current) against an owned disposable
# PostgreSQL: bootstrap a cluster unless the caller provides an owned one, run,
# and fail on any failure, error, skip or empty run.
set -euo pipefail
if [[ -n "${POSTGRES_HOME:-}" ]]; then export PATH="$POSTGRES_HOME/bin:$PATH"; fi
cd "$(dirname "$0")/../.."
root=$PWD
: "${HAYSTACK_SERVER_COMMAND:?explicit JVM/native executable command required}"
report="${HAYSTACK_REPORT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/haystack-current-report.XXXXXX")}"
if [[ -e "$report" ]]; then
  report_entries="$(ls -A "$report")"
  if [[ -n "$report_entries" ]]; then echo "refusing to overwrite an existing report: $report" >&2; exit 2; fi
fi
mkdir -p "$report"
if [[ -z "${HAYSTACK_TEST_JDBC:-}" ]]; then
  work="$(mktemp -d "${TMPDIR:-/tmp}/haystack-current-pg.XXXXXX")"
  pgport="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
  cleanup(){ pg_ctl -D "$work/pg" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
  trap cleanup EXIT
  initdb -D "$work/pg" -U postgres --auth=trust >/dev/null
  pg_ctl -D "$work/pg" -l "$report/postgres.log" -o "-k $work -p $pgport -h 127.0.0.1" start >/dev/null
  psql -h 127.0.0.1 -p "$pgport" -U postgres -c 'CREATE DATABASE haystack_current' >/dev/null
  (umask 077; printf 'synthetic-owned-test-password\n' > "$work/database-password")
  export HAYSTACK_OWNED_TEST_DB=1 HAYSTACK_TEST_JDBC="jdbc:postgresql://127.0.0.1:$pgport/haystack_current"
  export HAYSTACK_TEST_DB_USER=postgres HAYSTACK_TEST_DB_PASSWORD_FILE="$work/database-password"
  export HAYSTACK_FIXTURE_WORK_DIR="$work" HAYSTACK_OWNED_PGDATA="$work/pg"
  # Only the owned admin lane may create databases. A configured provision helper
  # returns a separate least-privilege runtime identity and is never bypassed.
  if [[ -z "${HAYSTACK_TEST_PROVISION_COMMAND:-}" ]]; then export HAYSTACK_FIXTURE_ADMIN_AUTHORIZED=1; fi
fi
[[ "${HAYSTACK_OWNED_TEST_DB:-}" == 1 ]] || { echo 'HAYSTACK_TEST_JDBC must name an owned disposable cluster (HAYSTACK_OWNED_TEST_DB=1)' >&2; exit 2; }
# Test files run concurrently, each with its own server, database, port and temp
# directory; HAYSTACK_CURRENT_CONCURRENCY=1 runs them serially. The cap keeps
# simultaneous servers (and their database connections) bounded: the 65 s
# two-heartbeat file holds one slot, the other files fit in the remaining three.
max_concurrency=4
cores=${NIX_BUILD_CORES:-0}; (( cores > 0 )) || cores=$(nproc)
concurrency=${HAYSTACK_CURRENT_CONCURRENCY:-$(( cores < max_concurrency ? cores : max_concurrency ))}
# Whole-run deadline: measured 64-66 s concurrent and 147 s serial under host
# load 150-220 (the 62 s two-heartbeat case is the concurrent floor); about 2x.
if (( concurrency == 1 )); then deadline=300; else deadline=150; fi
cd haystack
status=0
timeout --signal=TERM --kill-after=10s "$deadline" node --import ./scripts/register-generated.mjs --test --test-timeout=60000 --test-concurrency="$concurrency" \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=junit --test-reporter-destination="$report/transport.xml" \
  server/tests-current/*.test.mjs || status=$?
python3 "$root/scripts/junit-gate.py" --counts "$report/counts.json" "$report" || status=1
echo "Transport report: $report"
exit "$status"
