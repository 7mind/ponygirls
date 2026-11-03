#!/usr/bin/env bash
# Full executable transport leg: owned disposable PG only; no skipping/fallback.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${HAYSTACK_SERVER_COMMAND:?explicit JVM/native executable command required}"
: "${HAYSTACK_ARTIFACT_KIND:?set jvm or native to label this acceptance leg}"
[[ "$HAYSTACK_ARTIFACT_KIND" == jvm || "$HAYSTACK_ARTIFACT_KIND" == native ]]
work="$(mktemp -d "${TMPDIR:-/tmp}/haystack-current-pg.XXXXXX")"
report="${HAYSTACK_REPORT_DIR:-$work/report}"
mkdir -p "$report"
pgport="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
cleanup(){ pg_ctl -D "$work/pg" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
initdb -D "$work/pg" -U postgres --auth=trust >/dev/null
pg_ctl -D "$work/pg" -l "$work/postgres.log" -o "-k $work -p $pgport -h 127.0.0.1" start >/dev/null
psql -h 127.0.0.1 -p "$pgport" -U postgres -c 'CREATE DATABASE haystack_current' >/dev/null
umask 077
printf 'synthetic-owned-test-password\n' > "$work/database-password"
export HAYSTACK_OWNED_TEST_DB=1 HAYSTACK_TEST_JDBC="jdbc:postgresql://127.0.0.1:$pgport/haystack_current"
export HAYSTACK_TEST_DB_USER=postgres HAYSTACK_TEST_DB_PASSWORD_FILE="$work/database-password"
{
  git rev-parse HEAD
  git status --short
  printf 'artifact-kind=%s\ncommand=%s\n' "$HAYSTACK_ARTIFACT_KIND" "$HAYSTACK_SERVER_COMMAND"
  find haystack/server/src/main/scala haystack/server/tests-current haystack/generated -type f -print0 | sort -z | xargs -0 sha256sum
} > "$report/source.txt"
cd haystack
node --import ./scripts/register-generated.mjs --test --test-concurrency=1 --test-reporter=tap server/tests-current/*.test.mjs > "$report/transport.tap" 2>&1
cat "$report/transport.tap"
echo "Transport report: $report"
