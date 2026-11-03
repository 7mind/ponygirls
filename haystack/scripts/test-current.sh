#!/usr/bin/env bash
# Full executable transport leg: owned disposable PG only; no skipping/fallback.
set -euo pipefail
if [[ -n "${POSTGRES_HOME:-}" ]]; then export PATH="$POSTGRES_HOME/bin:$PATH"; fi
cd "$(dirname "$0")/../.."
: "${HAYSTACK_SERVER_COMMAND:?explicit JVM/native executable command required}"
: "${HAYSTACK_ARTIFACT_KIND:?set jvm or native to label this acceptance leg}"
: "${HAYSTACK_SERVER_ARTIFACT_FILE:?exact ELF or assembly JAR path required for SHA256 binding}"
[[ -f "$HAYSTACK_SERVER_ARTIFACT_FILE" ]]
[[ "$HAYSTACK_ARTIFACT_KIND" == jvm || "$HAYSTACK_ARTIFACT_KIND" == native ]]
work="$(mktemp -d "${TMPDIR:-/tmp}/haystack-current-pg.XXXXXX")"
report="${HAYSTACK_REPORT_DIR:-$work/report}"
if [[ -e "$report" && -n "$(ls -A "$report")" ]]; then echo "refusing to overwrite an existing report: $report" >&2; exit 2; fi
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
export HAYSTACK_FIXTURE_WORK_DIR="$work" HAYSTACK_OWNED_PGDATA="$work/pg"
# Only the owned admin lane may create databases. A configured provision helper
# returns a separate least-privilege runtime identity and is never bypassed.
if [[ -z "${HAYSTACK_TEST_PROVISION_COMMAND:-}" ]]; then export HAYSTACK_FIXTURE_ADMIN_AUTHORIZED=1; fi
{
  git rev-parse HEAD
  git status --short
  sha256sum "$HAYSTACK_SERVER_ARTIFACT_FILE"
  if [[ -n "${HAYSTACK_TEST_PROVISION_COMMAND:-}" ]]; then sha256sum "$HAYSTACK_TEST_PROVISION_COMMAND"; fi
  printf 'artifact-kind=%s\ncommand=%s\n' "$HAYSTACK_ARTIFACT_KIND" "$HAYSTACK_SERVER_COMMAND"
  find haystack/server/src/main/scala haystack/server/tests-current haystack/generated haystack/models haystack/migrations shared/service-runtime/src/main shared/baboon-runtime/src/main shared/lossless-json/src/main shared/retrieval-core/src/main shared/retrieval-postgres/src/main shared/model-http/src/main -type f -print0 | sort -z | xargs -0 sha256sum
} > "$report/source.txt"
cd haystack
set +e
timeout --signal=TERM --kill-after=10s 240s node --import ./scripts/register-generated.mjs --test --test-timeout=60000 --test-concurrency=1 --test-reporter=tap --test-reporter-destination="$report/transport.tap" --test-reporter=junit --test-reporter-destination="$report/transport.xml" server/tests-current/*.test.mjs > "$report/runner.log" 2>&1
status=$?
set -e
cat "$report/transport.tap" "$report/runner.log"
python3 - "$report" <<'PYVALIDATE'
import sys,json,pathlib,xml.etree.ElementTree as ET
report=pathlib.Path(sys.argv[1]); expected=json.loads(pathlib.Path('server/tests-current/inventory.json').read_text())
cases=list(ET.parse(report/'transport.xml').iter('testcase'))
names=[case.attrib['name'] for case in cases]
assert sorted(names)==sorted(expected), (len(names),len(expected),names)
failed=sum(len(c.findall('failure'))+len(c.findall('error')) for c in cases)
skipped=sum(len(c.findall('skipped')) for c in cases)
receipt={'cases':len(cases),'failuresAndErrors':failed,'skipped':skipped,'inventoryExact':True}
(report/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
assert cases and not failed and not skipped,receipt
PYVALIDATE
printf 'exit-status=%s\n' "$status" >> "$report/source.txt"
echo "Transport report: $report"
exit "$status"
