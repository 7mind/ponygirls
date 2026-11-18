#!/usr/bin/env bash
# Real CLI acceptance against the selected server executable and an owned
# disposable PostgreSQL; fails on any failure, error, skip or empty run.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${HAYSTACK_OWNED_TEST_DB:?owned disposable test database required}"
[[ "$HAYSTACK_OWNED_TEST_DB" == 1 ]]
: "${HAYSTACK_SERVER_COMMAND:?explicit Scala/native executable required}"
report=$(mktemp -d "${HAYSTACK_CLI_REPORT_ROOT:-${TMPDIR:-/tmp}}/haystack-cli-acceptance.XXXXXX")
status=0
timeout --signal=TERM --kill-after=10s 180s node --import ../scripts/register-generated.mjs --test --test-concurrency=1 --test-timeout=120000 \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=junit --test-reporter-destination="$report/acceptance.xml" tests/real.acceptance.mjs || status=$?
python3 ../../scripts/junit-gate.py --counts "$report/counts.json" "$report" || status=1
printf 'Real CLI acceptance report: %s\n' "$report"
exit "$status"
