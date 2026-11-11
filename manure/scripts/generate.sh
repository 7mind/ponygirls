#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BABOON:?set BABOON to the pinned 0.0.200 executable}"
echo '1d0debf771b8a22334e68cf7e6f99d55443f2451279eae3713ad1b155a96cfc4  '"$BABOON" | sha256sum -c -
"$BABOON" --model-dir models --lockfile models/lock.json \
 :scala --output generated/scala --omit-most-recent-version-suffix-from-paths --omit-most-recent-version-suffix-from-namespaces --generate-ueba-codecs=false --generate-json-codecs-by-default=true \
 :typescript --output generated/typescript --omit-most-recent-version-suffix-from-paths --omit-most-recent-version-suffix-from-namespaces --generate-ueba-codecs=false --generate-json-codecs-by-default=true --ts-import-suffix .js
python3 scripts/generate-python.py
