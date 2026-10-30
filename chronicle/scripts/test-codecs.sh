#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${TSC:?set TSC to the pinned dashboard TypeScript compiler}"
"$TSC" --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --rootDir . --outDir target/codec-js generated/typescript/chronicle/api/index.ts
node scripts/codec-fixtures.mjs
./scripts/sbt.sh 'testOnly chronicle.CodecFixtureTest chronicle.ApiVersionCompatibilityTest chronicle.ProtocolEvolutionTest'
