#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if (( $# != 0 )); then echo 'Usage: scripts/test-fast.sh (development only; no release evidence)' >&2; exit 2; fi
suites=()
while IFS= read -r suite; do suites+=("$suite"); done < scripts/fast-suites.txt
if (( ${#suites[@]} == 0 )); then echo 'Empty fast development suite' >&2; exit 1; fi
for suite in "${suites[@]}"; do
  if [[ ! "$suite" =~ ^chronicle\.[A-Za-z][A-Za-z0-9]*Test$ ]]; then echo 'Invalid fast suite name' >&2; exit 1; fi
done
unset CHRONICLE_TEST_JDBC
export CHRONICLE_REQUIRE_POSTGRES=1
printf 'DEVELOPMENT ONLY: %s explicitly selected parser/codec/pure/dummy suites; NOT release validation.\n' "${#suites[@]}"
./scripts/sbt.sh "testOnly ${suites[*]}"
