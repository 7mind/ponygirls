#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${TSC:?set TSC to the lockfile-pinned Chronicle dashboard TypeScript compiler}"
"$TSC" --target ES2022 --module ES2022 --moduleResolution Bundler --strict --skipLibCheck \
  --rootDir generated/typescript --outDir web/dashboard/current generated/typescript/manure/api/index.ts
