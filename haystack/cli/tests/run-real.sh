#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${HAYSTACK_OWNED_TEST_DB:?owned disposable test database required}"
[[ "$HAYSTACK_OWNED_TEST_DB" == 1 ]]
: "${HAYSTACK_SERVER_COMMAND:?explicit source-bound Scala/native executable required}"
: "${HAYSTACK_SERVER_ARTIFACT_FILE:?explicit source-bound ELF or JAR path required}"
[[ -f "$HAYSTACK_SERVER_ARTIFACT_FILE" ]]
report=$(mktemp -d "${HAYSTACK_CLI_REPORT_ROOT:-${TMPDIR:-/tmp}}/haystack-cli-acceptance.XXXXXX")
{
  git -c core.fsmonitor=false rev-parse HEAD
  git -c core.fsmonitor=false status --short
  sha256sum "$HAYSTACK_SERVER_ARTIFACT_FILE"
  find src tests ../generated/typescript -type f -print0 | sort -z | xargs -0 sha256sum
  sha256sum package.json package-lock.json tsconfig.json ../web/src/lossless-json.ts
} > "$report/source.txt"
set +e
timeout --signal=TERM --kill-after=10s 180s node --import ../scripts/register-generated.mjs --test --test-concurrency=1 --test-timeout=120000 \
  --test-reporter=tap --test-reporter-destination="$report/acceptance.tap" \
  --test-reporter=junit --test-reporter-destination="$report/acceptance.xml" tests/real.acceptance.mjs > "$report/runner.log" 2>&1
status=$?
set -e
cat "$report/acceptance.tap" "$report/runner.log"
python3 - "$report" <<'PY'
import json,pathlib,sys,xml.etree.ElementTree as ET
report=pathlib.Path(sys.argv[1]); cases=list(ET.parse(report/'acceptance.xml').iter('testcase'))
receipt={'cases':len(cases),'failures':sum(len(c.findall('failure')) for c in cases),'errors':sum(len(c.findall('error')) for c in cases),'skips':sum(len(c.findall('skipped')) for c in cases)}
(report/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
assert receipt=={'cases':12,'failures':0,'errors':0,'skips':0},receipt
PY
printf 'exit=%s\n' "$status" >> "$report/source.txt"
printf 'Real CLI acceptance report: %s\n' "$report"
exit "$status"
