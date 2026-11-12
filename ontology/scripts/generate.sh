#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BABOON:?use nix develop .#backend from the repository root}"
echo '1d0debf771b8a22334e68cf7e6f99d55443f2451279eae3713ad1b155a96cfc4  '"$BABOON" | sha256sum -c -
"$BABOON" --model-dir models --lockfile models/lock.json \
 :scala --output generated/scala --runtime without --omit-most-recent-version-suffix-from-paths --omit-most-recent-version-suffix-from-namespaces --generate-ueba-codecs=false --generate-json-codecs-by-default=true \
 :typescript --output generated/typescript --omit-most-recent-version-suffix-from-paths --omit-most-recent-version-suffix-from-namespaces --generate-ueba-codecs=false --generate-json-codecs-by-default=true --ts-import-suffix .js \
 :openapi --output generated/schema-input
web/node_modules/.bin/tsc -p scripts/tsconfig.schemas.json
node web/.cache/schema-builder/scripts/schema-generate.js generated/schema-input/ontology_api/v0_1_0/openapi.json models/ontology.baboon generated/wire generated/typescript/GeneratedWirePlan.ts 1d0debf771b8a22334e68cf7e6f99d55443f2451279eae3713ad1b155a96cfc4
