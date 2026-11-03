#!/usr/bin/env bash
# Full Scala contract verification: same memory/PG suites plus exact PG semantics.
# Owned, synthetic PostgreSQL only by default. An explicit external test database
# must be disposable and permit CREATE/DROP DATABASE for migration/cutover cases.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${POSTGRES_HOME:?run inside nix develop .#chronicle}"
report=$(mktemp -d "${TMPDIR:-/tmp}/haystack-scala-report.XXXXXX")
base=""
cleanup() {
  if [[ -n "$base" ]]; then
    "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >"$report/stop.log" 2>&1 || true
    rm -rf "$base"
  fi
}
trap cleanup EXIT
if [[ -z "${HAYSTACK_TEST_JDBC:-}" ]]; then
  base=$(mktemp -d "${TMPDIR:-/tmp}/haystack-scala-pg.XXXXXX")
  port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
  "$POSTGRES_HOME/bin/initdb" -D "$base/data" -U haystack_test -A trust --no-locale --encoding=UTF8 >"$report/init.log"
  "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$report/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start
  "$POSTGRES_HOME/bin/createdb" -h 127.0.0.1 -p "$port" -U haystack_test haystack_scala_test
  printf '%s' 'synthetic-test-password-not-a-secret' >"$base/password"
  chmod 600 "$base/password"
  export HAYSTACK_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/haystack_scala_test"
  export HAYSTACK_TEST_DB_USER=haystack_test
  export HAYSTACK_TEST_DB_PASSWORD_FILE="$base/password"
fi
: "${HAYSTACK_TEST_DB_USER:?explicit test user required}"
: "${HAYSTACK_TEST_DB_PASSWORD_FILE:?explicit test password file required}"
# Preserve old XML separately; never count stale passing results as this run.
xml=haystack/server/target/test-reports
if [[ -d "$xml" ]]; then mv "$xml" "$report/previous-test-reports"; fi
git rev-parse HEAD >"$report/source-commit"
git diff --binary HEAD >"$report/source-working-diff"
printf 'Reports: %s\n' "$report"
set +e
bash scripts/backend-sbt.sh "$@" 'haystackServer/Test/validationInventory' 'haystackServer/test' 2>&1 | tee "$report/tests.log"
status=${PIPESTATUS[0]}
set -e
cp haystack/server/target/validation-inventory.txt "$report/inventory.txt"
if [[ -d "$xml" ]]; then cp -a "$xml" "$report/test-reports"; fi
python3 - "$report" <<'PY'
import pathlib, sys, xml.etree.ElementTree as ET
root = pathlib.Path(sys.argv[1])
suites = [ET.parse(p).getroot() for p in (root/'test-reports').glob('*.xml')]
assert suites, 'no fresh XML test reports'
expected = sorted((root/'inventory.txt').read_text().splitlines())
observed = sorted(s.get('name') for s in suites)
assert observed == expected, f'fresh XML/inventory mismatch: expected={expected}, observed={observed}'
counts = {k: sum(int(s.get(k, '0')) for s in suites) for k in ('tests', 'failures', 'errors', 'skipped')}
print(f'Fresh suites={len(suites)} {counts}')
assert counts['failures'] == counts['errors'] == counts['skipped'] == 0, 'full production verification must execute without failures/errors/skips'
PY
exit "$status"
