#!/usr/bin/env bash
# Inner loop: runs Haystack test parts with their existing runners, concurrently where they share no state. Run inside
# `nix develop .#chronicle` after `npm ci` in haystack and haystack/cli. It is for iteration, not evidence: full
# verification is `scripts/verify haystack`. `native` and `browser` run against the native ELF built from this tree
# (`nix build .#haystack.nativeArtifact`: new files must be tracked, `git add -N`); `browser` uses the Chromium and nginx
# of the flake's pinned nixpkgs. Without arguments every part runs.
set -euo pipefail
usage='Usage: haystack/scripts/test.sh [jvm|native|web|browser|cli]...'
all_parts=(jvm native web browser cli)
# `browser` reinstalls haystack/node_modules (npm ci --offline), which `native` and `web` read: they run in sequence.
node_parts=(browser native web)
cd "$(dirname "$0")/../.."

part_jvm() { bash haystack/scripts/test-postgres-scala.sh; }
part_native() {
  HAYSTACK_ARTIFACT_KIND=native HAYSTACK_SERVER_ARTIFACT_FILE="$server" HAYSTACK_SERVER_COMMAND="$server" \
    bash haystack/scripts/test-current.sh
}
part_web() { cd haystack/web && npm run typecheck && npm test; }
part_browser() {
  HAYSTACK_ARTIFACT_KIND=native HAYSTACK_SERVER_ARTIFACT_FILE="$server" HAYSTACK_SERVER_COMMAND="$server" \
    HAYSTACK_CHROMIUM="$chromium/bin/chromium" HAYSTACK_NGINX="$nginx/bin/nginx" bash haystack/scripts/test-browser.sh
}
part_cli() { cd haystack/cli && npm run typecheck && npm test; }

contains() { local item=$1; shift; local candidate; for candidate in "$@"; do [[ $candidate == "$item" ]] && return 0; done; return 1; }
if (( $# == 0 )); then parts=("${all_parts[@]}"); else parts=("$@"); fi
checked=()
for part in "${parts[@]}"; do
  if ! contains "$part" "${all_parts[@]}" || contains "$part" "${checked[@]}"; then echo "$usage" >&2; exit 2; fi
  checked+=("$part")
done
if contains native "${parts[@]}" || contains browser "${parts[@]}"; then
  server="$(nix build --no-link --print-out-paths .#haystack.nativeArtifact)/libexec/haystack-server"
fi
if contains browser "${parts[@]}"; then
  chromium=$(nix build --no-link --print-out-paths --inputs-from . nixpkgs#chromium)
  nginx=$(nix build --no-link --print-out-paths --inputs-from . nixpkgs#nginx)
fi
# Logs stay in the ignored build directory: `nix develop` removes its TMPDIR on exit.
mkdir -p haystack/target/test-runs
logs=$(mktemp -d "$PWD/haystack/target/test-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
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
node_lane=()
for part in "${node_parts[@]}"; do if contains "$part" "${parts[@]}"; then node_lane+=("$part"); fi; done
if (( ${#node_lane[@]} > 0 )); then run_lane "${node_lane[@]}" & lanes+=($!); fi
for part in "${parts[@]}"; do
  if ! contains "$part" "${node_parts[@]}"; then run_lane "$part" & lanes+=($!); fi
done
for lane in "${lanes[@]}"; do wait "$lane"; done
failed=0
for part in "${parts[@]}"; do
  read -r status seconds < "$logs/$part.status"
  if (( status == 0 )); then outcome=PASS; else outcome="FAIL (exit $status)"; failed=1; fi
  printf '%-10s %-15s %5ss  %s\n' "$part" "$outcome" "$seconds" "$logs/$part.log"
done
exit "$failed"
