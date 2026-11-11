#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${BABOON:?use the pinned chronicle development shell}"
echo '1d0debf771b8a22334e68cf7e6f99d55443f2451279eae3713ad1b155a96cfc4  '"$BABOON" | sha256sum -c -
base=$(mktemp -d)
trap 'rm -rf "$base"' EXIT
# Regenerate canonical runtime independently; pinned runtime-only is model-agnostic.
"$BABOON" --model-dir chronicle/models :scala --output "$base/only" --runtime only \
  --omit-most-recent-version-suffix-from-paths --omit-most-recent-version-suffix-from-namespaces \
  --generate-ueba-codecs=false --generate-json-codecs-by-default=true
python3 - "$base/only" "$@" <<'PY'
import hashlib
import pathlib
import sys
canonical = pathlib.Path('shared/baboon-runtime/src/main/scala')
def files(path):
    return {p.name: p.read_bytes() for p in pathlib.Path(path).glob('Baboon*.scala')}
expected = files(canonical)
assert expected, 'missing canonical runtime'
for generated in sys.argv[1:]:
    actual = files(generated)
    assert actual.keys() == expected.keys(), f'runtime file set differs: {generated}'
    for name, content in expected.items():
        assert actual[name] == content, f'runtime bytes differ: {generated}/{name}'
    print(f'PASS {generated}: {len(actual)} byte-identical runtime sources')
for name, content in sorted(expected.items()):
    print(hashlib.sha256(content).hexdigest(), name)
PY
