#!/usr/bin/env bash
# Link the pinned Pi SDK (from the installed Nix pi-coding-agent package) into
# the rites workspace so TypeScript and Node resolve the real SDK, not an
# npm-registry copy. Idempotent; run after `npm ci` (which removes
# node_modules). The pinned backend shell supplies PI_MONOREPO_ROOT.
set -euo pipefail

RITES_DIR="$(cd "$(dirname "$0")/.." && pwd)"
: "${PI_MONOREPO_ROOT:?use nix develop .#backend or set the pinned Pi SDK path explicitly}"
SDK_ROOT="$PI_MONOREPO_ROOT"
EXPECTED_VERSION="1.5.2"

fail() {
  echo "prepare-sdk: $*" >&2
  exit 1
}

[ -d "$SDK_ROOT/dist" ] || fail "SDK root not found: $SDK_ROOT (set PI_MONOREPO_ROOT)"
[ -f "$SDK_ROOT/package.json" ] || fail "SDK package.json missing: $SDK_ROOT"
actual_version="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "$SDK_ROOT/package.json")"
[ "$actual_version" = "$EXPECTED_VERSION" ] || fail "SDK version $actual_version, expected $EXPECTED_VERSION"
[ -d "$SDK_ROOT/node_modules/@earendil-works/pi-ai" ] || fail "SDK pi-ai dependency missing"

link() {
  local target="$1" name="$2"
  mkdir -p "$(dirname "$target")"
  ln -sfn "$SDK_ROOT/$name" "$target"
}

for consumer in node_modules target/worker/node_modules; do
  link "$RITES_DIR/$consumer/@earendil-works/pi-coding-agent" "."
  link "$RITES_DIR/$consumer/@earendil-works/pi-ai" "node_modules/@earendil-works/pi-ai"
  link "$RITES_DIR/$consumer/@earendil-works/pi-agent-core" "node_modules/@earendil-works/pi-agent-core"
  mkdir -p "$RITES_DIR/$consumer/@types"
  ln -sfn "$SDK_ROOT/node_modules/@types/node" "$RITES_DIR/$consumer/@types/node"
done

echo "prepare-sdk: linked @earendil-works/pi-coding-agent $EXPECTED_VERSION from $SDK_ROOT"
