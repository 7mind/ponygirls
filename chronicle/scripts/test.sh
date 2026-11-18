#!/usr/bin/env bash
# Inner loop: runs Chronicle test parts with their existing runners, concurrently where they share no state (the sbt
# parts share one build and run in sequence). Run inside `nix develop .#chronicle` after `npm ci` in chronicle/web,
# chronicle/collector and chronicle/cli. It is for iteration, not evidence: full verification is `scripts/verify chronicle`.
# Without arguments every part except `fast` runs (`fast` is a subset of `backend`).
set -euo pipefail
usage='Usage: chronicle/scripts/test.sh [backend|fast|web|browser|collector|cli|codecs|eval]...'
all_parts=(backend fast web browser collector cli codecs eval)
default_parts=(backend web browser collector cli codecs eval)
sbt_parts=(backend codecs fast)
cd "$(dirname "$0")/../.."

part_backend() { bash chronicle/scripts/test-postgres.sh; }
part_fast() { bash chronicle/scripts/test-fast.sh; }
part_web() { cd chronicle/web && npm run typecheck && npm test; }
part_browser() { cd chronicle/web && npm run test:browser; }
part_collector() { cd chronicle/collector && npm run typecheck && npm test; }
part_cli() { cd chronicle/cli && npm run typecheck && npm test; }
part_codecs() { cd chronicle && TSC="$PWD/web/node_modules/.bin/tsc" ./scripts/test-codecs.sh; }
part_eval() { python3 -m unittest discover -s chronicle/eval/relevance/tests -v && node --test chronicle/eval/relevance/tests/*.test.mjs; }

contains() { local item=$1; shift; local candidate; for candidate in "$@"; do [[ $candidate == "$item" ]] && return 0; done; return 1; }
if (( $# == 0 )); then parts=("${default_parts[@]}"); else parts=("$@"); fi
checked=()
for part in "${parts[@]}"; do
  if ! contains "$part" "${all_parts[@]}" || contains "$part" "${checked[@]}"; then echo "$usage" >&2; exit 2; fi
  checked+=("$part")
done
# Logs stay in the ignored build directory: `nix develop` removes its TMPDIR on exit.
mkdir -p chronicle/target/test-runs
logs=$(mktemp -d "$PWD/chronicle/target/test-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
run_part() {
  local name=$1 started=$SECONDS status=0
  ( "part_$name" ) > "$logs/$name.log" 2>&1 || status=$?
  printf '%s %s\n' "$status" "$((SECONDS - started))" > "$logs/$name.status"
}
run_lane() { local name; for name in "$@"; do run_part "$name"; done; }
# Each lane is its own process group, so an interrupt stops whole runner trees and their EXIT traps run.
set -m
lanes=()
trap 'for lane in "${lanes[@]}"; do kill -TERM -- "-$lane" 2>/dev/null || true; done; wait; exit 130' INT TERM
sbt_lane=()
for part in "${sbt_parts[@]}"; do if contains "$part" "${parts[@]}"; then sbt_lane+=("$part"); fi; done
if (( ${#sbt_lane[@]} > 0 )); then run_lane "${sbt_lane[@]}" & lanes+=($!); fi
for part in "${parts[@]}"; do
  if ! contains "$part" "${sbt_parts[@]}"; then run_lane "$part" & lanes+=($!); fi
done
for lane in "${lanes[@]}"; do wait "$lane"; done
failed=0
for part in "${parts[@]}"; do
  read -r status seconds < "$logs/$part.status"
  if (( status == 0 )); then outcome=PASS; else outcome="FAIL (exit $status)"; failed=1; fi
  printf '%-10s %-15s %5ss  %s\n' "$part" "$outcome" "$seconds" "$logs/$part.log"
done
exit "$failed"
