#!/usr/bin/env bash
# Inner loop: runs Manure test parts with their existing runners, concurrently (they share no state). Run inside
# `nix develop .#chronicle` after `npm ci` in manure/web/viewer. It is for iteration, not evidence: full verification is
# `scripts/verify manure`. `target` runs the full target suite against the native ELF built from this tree (new files
# must be tracked, `git add -N`), in the environment of the manure-native check (pinned Chromium, Playwright, MCP SDK,
# packaged viewer) and on an owned provider cluster. Without arguments every part runs.
set -euo pipefail
usage='Usage: manure/scripts/test.sh [jvm|target|viewer]...'
all_parts=(jvm target viewer)
cd "$(dirname "$0")/../.."

part_jvm() { bash manure/scripts/test-backend.sh; }
part_target() {
  nix develop .#checks.x86_64-linux.manure-native --command \
    "$tools/bin/with-service-postgres" bash manure/scripts/test-target.sh native "$server"
}
part_viewer() { cd manure/web/viewer && npm test; }

contains() { local item=$1; shift; local candidate; for candidate in "$@"; do [[ $candidate == "$item" ]] && return 0; done; return 1; }
if (( $# == 0 )); then parts=("${all_parts[@]}"); else parts=("$@"); fi
checked=()
for part in "${parts[@]}"; do
  if ! contains "$part" "${all_parts[@]}" || contains "$part" "${checked[@]}"; then echo "$usage" >&2; exit 2; fi
  checked+=("$part")
done
if contains target "${parts[@]}"; then
  server="$(nix build --no-link --print-out-paths .#manure.nativeArtifact)/libexec/manure-server"
  tools=$(nix build --no-link --print-out-paths .#service-test-fixture-tools)
fi
# Logs stay in the ignored build directory: `nix develop` removes its TMPDIR on exit.
mkdir -p manure/target/test-runs
logs=$(mktemp -d "$PWD/manure/target/test-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
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
  printf '%-10s %-15s %5ss  %s\n' "$part" "$outcome" "$seconds" "$logs/$part.log"
done
exit "$failed"
