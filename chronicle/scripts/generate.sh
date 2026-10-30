#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BABOON:?set BABOON to the pinned 0.0.198 executable}"
echo '6470f599d47cc3f685efc4ccf4ddcc8492bfd0dcd87a88bf76ed7bfee0f77f36  '"$BABOON" | sha256sum -c -
"$BABOON" --model-dir models --lockfile models/lock.json \
 :scala --output generated/scala --omit-most-recent-version-suffix-from-paths --omit-most-recent-version-suffix-from-namespaces --generate-ueba-codecs=false --generate-json-codecs-by-default=true \
 :typescript --output generated/typescript --omit-most-recent-version-suffix-from-paths --omit-most-recent-version-suffix-from-namespaces --generate-ueba-codecs=false --generate-json-codecs-by-default=true --ts-import-suffix .js
