#!/usr/bin/env bash
# Inner loop: runs the shared-module tests with their existing runners, concurrently (they share no state). Run inside
# `nix develop .#chronicle` after `npm ci` in chronicle/web (the account-web browser test loads its Playwright). It is
# for iteration, not evidence: full verification is `scripts/verify all` (the shared-jvm and account-web-browser checks
# are members of every service's verify target). Without arguments every part runs.
set -euo pipefail
usage='Usage: shared/scripts/test.sh [jvm|account-web]...'
all_parts=(jvm account-web)
cd "$(dirname "$0")/../.."

# The six shared sbt modules against one owned PostgreSQL cluster (the runner of the shared-jvm check).
part_jvm() { bash nix/tests/shared-jvm.sh; }
part_account-web() {
  node --test shared/account-web/tests/account-client.test.mjs && node shared/account-web/tests/browser.mjs
}

contains() { local item=$1; shift; local candidate; for candidate in "$@"; do [[ $candidate == "$item" ]] && return 0; done; return 1; }
if (( $# == 0 )); then parts=("${all_parts[@]}"); else parts=("$@"); fi
checked=()
for part in "${parts[@]}"; do
  if ! contains "$part" "${all_parts[@]}" || contains "$part" "${checked[@]}"; then echo "$usage" >&2; exit 2; fi
  checked+=("$part")
done
# Logs stay in the ignored build directory: `nix develop` removes its TMPDIR on exit.
mkdir -p shared/target/test-runs
logs=$(mktemp -d "$PWD/shared/target/test-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
run_part() {
  local name=$1 started=$SECONDS status=0
  ( "part_$name" ) > "$logs/$name.log" 2>&1 || status=$?
  printf '%s %s\n' "$status" "$((SECONDS - started))" > "$logs/$name.status"
}
# Each part is its own process group, so an interrupt stops whole runner trees and their EXIT traps run.
set -m
lanes=()
trap 'for lane in "${lanes[@]}"; do kill -TERM -- "-$lane" 2>/dev/null || true; done; wait; exit 130' INT TERM
for part in "${parts[@]}"; do run_part "$part" & lanes+=($!); done
for lane in "${lanes[@]}"; do wait "$lane"; done
failed=0
for part in "${parts[@]}"; do
  read -r status seconds < "$logs/$part.status"
  if (( status == 0 )); then outcome=PASS; else outcome="FAIL (exit $status)"; failed=1; fi
  printf '%-12s %-15s %5ss  %s\n' "$part" "$outcome" "$seconds" "$logs/$part.log"
done
exit "$failed"
