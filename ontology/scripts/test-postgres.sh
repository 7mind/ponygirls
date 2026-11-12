#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${POSTGRES_HOME:?use nix develop .#backend}"
mkdir -p ontology/server/target/validation-runs .local
report=$(mktemp -d "$PWD/ontology/server/target/validation-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
if [[ -d ontology/server/target/test-reports ]]; then mv ontology/server/target/test-reports "$report/previous-test-reports"; fi
if [[ -f ontology/server/target/validation-inventory.txt ]]; then mv ontology/server/target/validation-inventory.txt "$report/previous-inventory.txt"; fi
source_manifest() {
  find build.sbt project deps.lock.json lockfile-config.json scripts/backend-sbt.sh ontology/models ontology/generated/scala ontology/generated/typescript ontology/generated/schema-input ontology/generated/wire ontology/web/package.json ontology/web/package-lock.json ontology/server/src ontology/migrations ontology/scripts ontology/web/src ontology/web/tests ontology/web/tests-browser ontology/web/tsconfig.json ontology/web/tsconfig.fixtures.json ontology/worker/src ontology/worker/scripts ontology/worker/tests ontology/worker/package.json ontology/worker/package-lock.json ontology/worker/tsconfig.json shared/service-runtime/src shared/baboon-runtime/src shared/lossless-json/src shared/model-http/src shared/retrieval-core/src shared/retrieval-postgres/src -type f \( -name '*.scala' -o -name '*.sbt' -o -name '*.properties' -o -name '*.sh' -o -name '*.baboon' -o -name '*.sql' -o -name '*.json' -o -name '*.ts' -o -name '*.mjs' -o -name '*.tsx' -o -name '*.py' -o -name '*.css' \) ! -path '*/target/*' ! -path 'project/project/*' -print0 | sort -z | xargs -0 sha256sum
}
source_manifest > "$report/source.sha256"
git rev-parse HEAD > "$report/git-head"
java -version 2> "$report/java-version"
"$POSTGRES_HOME/bin/postgres" --version > "$report/postgres-version"
printf 'Ontology validation receipt: %s\n' "$report"
base=$(mktemp -d "${TMPDIR:-/tmp}/ontology-pg.XXXXXX")
cleanup() {
  "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop > "$report/postgres-stop.log" 2>&1 || true
  if [[ -f "$base/server.log" ]]; then cp "$base/server.log" "$report/postgres-server.log"; fi
  rm -rf -- "$base"
}
trap cleanup EXIT
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
printf '%s\n' ontology-owned-test-password > "$base/password"
chmod 600 "$base/password"
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$report/postgres-init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start
export ONTOLOGY_TEST_JDBC_URL="jdbc:postgresql://127.0.0.1:$port/postgres"
export ONTOLOGY_TEST_PASSWORD_FILE="$base/password"
set +e
bash scripts/backend-sbt.sh 'ontologyServer/Test/validationInventory' 'ontologyServer/testFull' "$@" 2>&1 | tee "$report/run.log"
status=${PIPESTATUS[0]}
set -e
printf '%s\n' "$status" > "$report/exit-status"
if [[ -d ontology/server/target/test-reports ]]; then cp -r ontology/server/target/test-reports "$report/test-reports"; fi
if [[ -f ontology/server/target/validation-inventory.txt ]]; then cp ontology/server/target/validation-inventory.txt "$report/inventory.txt"; fi
if [[ "$status" != 0 ]]; then exit "$status"; fi
source_manifest > "$report/source-after.sha256"
cmp "$report/source.sha256" "$report/source-after.sha256"
python3 - "$report" <<'PY'
import json, pathlib, sys, xml.etree.ElementTree as ET
root = pathlib.Path(sys.argv[1])
expected = root.joinpath('inventory.txt').read_text().splitlines()
reports = [ET.parse(p).getroot() for p in root.joinpath('test-reports').glob('*.xml')]
actual = [r.attrib['name'] for r in reports]
assert expected and len(set(expected)) == len(expected)
assert sorted(actual) == sorted(expected), (actual, expected)
counts = {name: sum(int(r.attrib.get(name, '0')) for r in reports) for name in ('tests', 'failures', 'errors', 'skipped')}
counts['suites'] = len(reports)
assert counts['tests'] > 0 and counts['failures'] == counts['errors'] == counts['skipped'] == 0, counts
root.joinpath('summary.json').write_text(json.dumps(counts, indent=2) + '\n')
print('Verified unfiltered ontology inventory:', counts)
PY
