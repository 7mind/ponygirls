#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if (( $# != 0 )); then echo 'Usage: scripts/test-fast.sh (explicit fast subset; not full validation)' >&2; exit 2; fi
suites=()
while IFS= read -r suite; do suites+=("$suite"); done < scripts/fast-suites.txt
if (( ${#suites[@]} == 0 )); then echo 'Empty fast suite selection' >&2; exit 1; fi
declare -A seen=()
for suite in "${suites[@]}"; do
  if [[ ! "$suite" =~ ^chronicle\.[A-Za-z][A-Za-z0-9]*Test$ ]]; then echo 'Invalid fast suite name' >&2; exit 1; fi
  if [[ -v seen[$suite] ]]; then echo 'Duplicate fast suite name' >&2; exit 1; fi
  seen[$suite]=1
done
unset CHRONICLE_TEST_JDBC
export CHRONICLE_REQUIRE_POSTGRES=1
printf 'FAST SUBSET: %s explicitly selected parser/codec/pure/dummy suites; NOT full validation.\n' "${#suites[@]}"
./scripts/sbt.sh 'Test / validationInventory' "testOnly ${suites[*]}"
